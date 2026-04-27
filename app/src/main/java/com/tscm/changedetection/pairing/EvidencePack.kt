package com.tscm.changedetection.pairing

import android.util.Base64
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Pure-Kotlin builder for the PixelSentinel "Evidence Pack v1" zip format.
 *
 *  The same format is consumed by:
 *   - The desktop server at POST /api/v1/import/pack
 *   - Any future desktop tool that knows how to open a zip with a manifest.
 *
 *  The same zip is also what the existing Android share-sheet export
 *  produces, so this builder is the single source of truth on the phone.
 */
object EvidencePack {

    /** Analysis settings that produced [Stats] / the result image. */
    data class Params(
        val strength: Int,
        val morphSize: Int,
        val closeSize: Int,
        val minRegion: Int,
        val preBlurSigma: Double,
        val normalizeLuma: Boolean,
        val highlightR: Int,
        val highlightG: Int,
        val highlightB: Int,
        val highlightAlpha: Double
    )

    data class Stats(
        val changedPct: Double,
        val changedPixels: Int,
        val regions: Int
    )

    /** Optional alignment that was applied. JSON arrays as produced by AlignmentFragment. */
    data class Warp(
        val srcJson: String,
        val dstJson: String
    )

    /**
     * Build an Evidence Pack v1 zip into a byte array.
     *
     *  When [signed] is true the manifest gains:
     *    - `digests`: SHA-256 of each carried file body, prefixed "sha256:".
     *    - `signer`:  algorithm + base64 X.509 SubjectPublicKeyInfo.
     *    - `signature`: base64 DER ECDSA(r,s) over the canonical signing
     *                   payload (must match Go's evidencepack.SigningDigest).
     *
     *  Unsigned packs (signed=false) keep the original v1 layout for
     *  backwards compatibility with older desktops.
     */
    fun build(
        label: String,
        capturedAtMs: Long,
        params: Params,
        stats: Stats?,
        beforeJpg: ByteArray,
        afterJpg: ByteArray,
        resultPng: ByteArray? = null,
        warp: Warp? = null,
        signed: Boolean = true
    ): ByteArray {
        val isoTimestamp = isoFormatter.format(Date(capturedAtMs))
        val source = "phone:android"

        val digestBefore = "sha256:" + sha256Hex(beforeJpg)
        val digestAfter = "sha256:" + sha256Hex(afterJpg)
        val digestResult = resultPng?.let { "sha256:" + sha256Hex(it) } ?: ""

        // Sign first, then assemble the manifest with the signature embedded.
        // Both sides must build the signing payload byte-for-byte identically;
        // see internal/evidencepack/sign.go on the Go side.
        var signature = ""
        var signerPubB64 = ""
        if (signed) {
            signerPubB64 = ManifestSigner.publicKeyBase64()
            val payload = buildSigningPayload(
                version = 1,
                label = label,
                capturedAt = isoTimestamp,
                source = source,
                digestBefore = digestBefore,
                digestAfter = digestAfter,
                digestResult = digestResult,
                signerAlg = ManifestSigner.ALG_ID,
                signerPub = signerPubB64
            )
            signature = Base64.encodeToString(ManifestSigner.sign(payload), Base64.NO_WRAP)
        }

        val manifest = buildManifestJson(
            label = label,
            capturedAtIso = isoTimestamp,
            source = source,
            stats = stats,
            params = params,
            warp = warp,
            includeResult = resultPng != null,
            digestBefore = digestBefore,
            digestAfter = digestAfter,
            digestResult = digestResult,
            signerAlg = if (signed) ManifestSigner.ALG_ID else "",
            signerPubB64 = signerPubB64,
            signatureB64 = signature
        )

        val out = ByteArrayOutputStream(64 * 1024)
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json"))
            zip.write(manifest.toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("before.jpg"))
            zip.write(beforeJpg)
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("after.jpg"))
            zip.write(afterJpg)
            zip.closeEntry()

            if (resultPng != null) {
                zip.putNextEntry(ZipEntry("result.png"))
                zip.write(resultPng)
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    /**
     * Build the canonical signing payload — must produce the same bytes
     * as Go's evidencepack.SigningDigest (before sha256). Length-prefixed
     * concatenation of selected fields, prepended by a domain separator.
     */
    private fun buildSigningPayload(
        version: Int,
        label: String,
        capturedAt: String,
        source: String,
        digestBefore: String,
        digestAfter: String,
        digestResult: String,
        signerAlg: String,
        signerPub: String
    ): ByteArray {
        val out = ByteArrayOutputStream(512)
        out.write(SIGNING_DOMAIN.toByteArray(Charsets.UTF_8))
        writeFieldLP(out, version.toString())
        writeFieldLP(out, label)
        writeFieldLP(out, capturedAt)
        writeFieldLP(out, source)
        writeFieldLP(out, digestBefore)
        writeFieldLP(out, digestAfter)
        writeFieldLP(out, digestResult)
        writeFieldLP(out, signerAlg)
        writeFieldLP(out, signerPub)
        return out.toByteArray()
    }

    private fun writeFieldLP(out: ByteArrayOutputStream, s: String) {
        val b = s.toByteArray(Charsets.UTF_8)
        val hdr = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(b.size.toLong()).array()
        out.write(hdr)
        out.write(b)
    }

    private fun sha256Hex(b: ByteArray): String {
        val sum = MessageDigest.getInstance("SHA-256").digest(b)
        val sb = StringBuilder(sum.size * 2)
        for (byte in sum) {
            sb.append(HEX[(byte.toInt() shr 4) and 0xF])
            sb.append(HEX[byte.toInt() and 0xF])
        }
        return sb.toString()
    }

    private fun buildManifestJson(
        label: String,
        capturedAtIso: String,
        source: String,
        stats: Stats?,
        params: Params,
        warp: Warp?,
        includeResult: Boolean,
        digestBefore: String,
        digestAfter: String,
        digestResult: String,
        signerAlg: String,
        signerPubB64: String,
        signatureB64: String
    ): String {
        val warpJson = if (warp != null) {
            ""","warp":{"src":${warp.srcJson},"dst":${warp.dstJson}}"""
        } else ""

        val resultEntry = if (includeResult) ""","result":"result.png"""" else ""

        val statsObj = stats?.let {
            """{"changedPct":${it.changedPct},"changedPixels":${it.changedPixels},"regions":${it.regions}}"""
        } ?: """{"changedPct":0,"changedPixels":0,"regions":0}"""

        val resultDigest = if (digestResult.isNotEmpty()) ""","result":"${escape(digestResult)}"""" else ""
        val digestsBlock = ""","digests":{"before":"${escape(digestBefore)}","after":"${escape(digestAfter)}"$resultDigest}"""

        val signerBlock = if (signerAlg.isNotEmpty() && signerPubB64.isNotEmpty()) {
            ""","signer":{"alg":"${escape(signerAlg)}","publicKey":"${escape(signerPubB64)}"}"""
        } else ""

        val signatureBlock = if (signatureB64.isNotEmpty()) {
            ""","signature":"${escape(signatureB64)}""""
        } else ""

        return """{
  "version": 1,
  "label": "${escape(label)}",
  "capturedAt": "$capturedAtIso",
  "source": "${escape(source)}",
  "stats": $statsObj,
  "params": {
    "strength": ${params.strength},
    "morphSize": ${params.morphSize},
    "closeSize": ${params.closeSize},
    "minRegion": ${params.minRegion},
    "preBlurSigma": ${params.preBlurSigma},
    "normalizeLuma": ${params.normalizeLuma},
    "highlightR": ${params.highlightR},
    "highlightG": ${params.highlightG},
    "highlightB": ${params.highlightB},
    "highlightAlpha": ${params.highlightAlpha}
  }$warpJson,
  "files": {
    "before": "before.jpg",
    "after": "after.jpg"$resultEntry
  }$digestsBlock$signerBlock$signatureBlock
}
"""
    }

    private fun escape(s: String): String = s
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")

    private val isoFormatter: SimpleDateFormat by lazy {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
    }

    private val HEX = "0123456789abcdef".toCharArray()

    /** MUST match the Go side's `signingDomain` constant byte-for-byte. */
    private const val SIGNING_DOMAIN = "PIXELSENTINEL-PACK-SIG-v1 "
}
