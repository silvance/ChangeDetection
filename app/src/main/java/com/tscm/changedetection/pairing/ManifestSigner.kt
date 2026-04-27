package com.tscm.changedetection.pairing

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Producer-signing key for PixelSentinel Evidence Packs.
 *
 * Generates an ECDSA P-256 keypair in Android Keystore the first time
 * the app needs it, then keeps using the same key forever. The private
 * key never leaves the secure element; signing happens through the
 * Keystore API, so the rest of the app only ever holds public material.
 *
 * Why P-256 and not Ed25519: Android Keystore only got Ed25519 in API
 * 33 and our minSdk is 26. ECDSA P-256 has been there since 23 and
 * matches the desktop Go verifier (crypto/ecdsa + crypto/x509 PKIX).
 */
object ManifestSigner {

    const val ALG_ID = "ecdsa-p256-sha256"
    private const val KEY_ALIAS = "pixelsentinel-pack-signing-v1"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"

    /** Lazily ensures the keypair exists; returns the cached private key reference. */
    private val privateKey: PrivateKey
        get() {
            val ks = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
            ks.getKey(KEY_ALIAS, null)?.let { return it as PrivateKey }
            generateKeyPair()
            return ks.apply { load(null) }.getKey(KEY_ALIAS, null) as PrivateKey
        }

    /** Public key matching [privateKey], retrieved from the certificate the
     *  Keystore wraps the keypair in. */
    private val publicKey: PublicKey
        get() {
            val ks = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
            ks.getCertificate(KEY_ALIAS)?.publicKey?.let { return it }
            generateKeyPair()
            return KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
                .getCertificate(KEY_ALIAS).publicKey
        }

    /** Returns the X.509 SubjectPublicKeyInfo bytes, base64-encoded.
     *  This is exactly what the Go-side x509.ParsePKIXPublicKey accepts. */
    fun publicKeyBase64(): String {
        val spki = publicKey.encoded
        return Base64.encodeToString(spki, Base64.NO_WRAP)
    }

    /** Stable 16-char identifier for the signing key — first 16 hex chars
     *  of SHA-256(SPKI). Useful for Settings UI and operator visual checks. */
    fun fingerprint(): String {
        val sum = MessageDigest.getInstance("SHA-256").digest(publicKey.encoded)
        val hex = StringBuilder(16)
        for (i in 0 until 8) {
            hex.append(HEX[(sum[i].toInt() shr 4) and 0xF])
            hex.append(HEX[sum[i].toInt() and 0xF])
        }
        return hex.toString()
    }

    /**
     * Sign [payload] with SHA256withECDSA. Returns the DER-encoded
     * ECDSA(r, s) signature bytes — what `ecdsa.VerifyASN1` accepts.
     */
    fun sign(payload: ByteArray): ByteArray {
        val sig = Signature.getInstance("SHA256withECDSA").apply {
            initSign(privateKey)
            update(payload)
        }
        return sig.sign()
    }

    private fun generateKeyPair() {
        val kpg = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER
        )
        val builder = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        // setIsStrongBoxBacked is API 28+; opportunistically request it but
        // fall back if the device doesn't have a StrongBox.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                builder.setIsStrongBoxBacked(true)
                kpg.initialize(builder.build())
                kpg.generateKeyPair()
                return
            } catch (_: Throwable) {
                // Fallthrough to non-StrongBox path.
            }
        }
        kpg.initialize(builder.build())
        kpg.generateKeyPair()
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
