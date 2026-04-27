package evidencepack

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"
)

// AlgECDSAP256SHA256 is the only signature algorithm currently defined.
const AlgECDSAP256SHA256 = "ecdsa-p256-sha256"

// Signed-pack constants kept stable across releases — changing any of
// these would silently invalidate every previously-signed pack.
const (
	// signingDomain is prepended to the SigningPayload so this signature
	// can never be replayed against any other format.
	signingDomain = "PIXELSENTINEL-PACK-SIG-v1\x00"
)

// VerifyResult is what Verify returns.
type VerifyResult struct {
	// Signed is true when the pack carries a Signer + Signature pair.
	Signed bool
	// Verified is true when Signed is true AND the signature checked out
	// against the embedded public key AND the digests match the bytes.
	// For unsigned packs Verified is always false.
	Verified bool
	// Reason is set when Verified is false on a signed pack — e.g.
	// "signature mismatch", "digest mismatch (before)".
	Reason string
	// SignerFingerprint is the lowercase hex SHA-256 of the public key
	// bytes, truncated to 16 chars. Stable across encodings of the same
	// key, useful as a short identifier in UI / logs.
	SignerFingerprint string
}

// Verify checks a parsed Pack against its manifest.signature, if any.
//
// It returns nil error for both verified-good and verified-bad packs;
// the caller inspects VerifyResult.Verified / .Reason to tell them
// apart. A non-nil error is reserved for *malformed* packs that
// couldn't be parsed at all.
//
// Unsigned packs are accepted (Signed=false, Verified=false). Trust
// decisions about unsigned vs signed-by-unknown-key are the caller's
// concern, not ours.
func Verify(p *Pack) (VerifyResult, error) {
	if p == nil {
		return VerifyResult{}, errors.New("nil pack")
	}
	m := p.Manifest

	// Always validate digests when they're present — they're useful even
	// for unsigned packs, since they catch zip-level corruption.
	if m.Digests != nil {
		if err := verifyDigest(m.Digests.Before, p.BeforeJPG, "before"); err != nil {
			return VerifyResult{Signed: m.Signature != "", Reason: err.Error()}, nil
		}
		if err := verifyDigest(m.Digests.After, p.AfterJPG, "after"); err != nil {
			return VerifyResult{Signed: m.Signature != "", Reason: err.Error()}, nil
		}
		if m.Digests.Result != "" {
			if err := verifyDigest(m.Digests.Result, p.ResultPNG, "result"); err != nil {
				return VerifyResult{Signed: m.Signature != "", Reason: err.Error()}, nil
			}
		}
	}

	if m.Signature == "" || m.Signer == nil {
		return VerifyResult{Signed: false}, nil
	}

	if m.Signer.Alg != AlgECDSAP256SHA256 {
		return VerifyResult{
			Signed: true,
			Reason: fmt.Sprintf("unsupported signer.alg %q", m.Signer.Alg),
		}, nil
	}
	if m.Digests == nil {
		// A signed pack without digests is meaningless — nothing the
		// signature could commit to about the file bytes.
		return VerifyResult{Signed: true, Reason: "signed pack has no digests"}, nil
	}

	pubBytes, err := base64.StdEncoding.DecodeString(m.Signer.PublicKey)
	if err != nil {
		return VerifyResult{Signed: true, Reason: "publicKey not valid base64"}, nil
	}
	pubAny, err := x509.ParsePKIXPublicKey(pubBytes)
	if err != nil {
		return VerifyResult{Signed: true, Reason: "publicKey not a valid SPKI: " + err.Error()}, nil
	}
	pub, ok := pubAny.(*ecdsa.PublicKey)
	if !ok {
		return VerifyResult{Signed: true, Reason: "publicKey is not ECDSA"}, nil
	}
	if pub.Curve != elliptic.P256() {
		return VerifyResult{Signed: true, Reason: "publicKey is not on P-256"}, nil
	}

	sig, err := base64.StdEncoding.DecodeString(m.Signature)
	if err != nil {
		return VerifyResult{Signed: true, Reason: "signature not valid base64"}, nil
	}

	digest := SigningDigest(m)
	if !ecdsa.VerifyASN1(pub, digest, sig) {
		return VerifyResult{
			Signed:            true,
			Reason:            "signature mismatch",
			SignerFingerprint: fingerprint(pubBytes),
		}, nil
	}

	return VerifyResult{
		Signed:            true,
		Verified:          true,
		SignerFingerprint: fingerprint(pubBytes),
	}, nil
}

// SigningDigest returns the SHA-256 over the canonical signing payload
// for a manifest. Phones produce the same bytes when they sign;
// desktops produce them again to verify.
//
// The payload is intentionally NOT the JSON-serialised manifest, because
// JSON serialisation isn't byte-stable across implementations. Instead
// it's a length-prefixed concatenation of the fields the signature
// covers, in a fixed order. Both sides must implement this identically.
func SigningDigest(m Manifest) []byte {
	var buf bytes.Buffer
	buf.WriteString(signingDomain)
	writeFieldLP(&buf, strconv.Itoa(m.Version))
	writeFieldLP(&buf, m.Label)
	writeFieldLP(&buf, m.CapturedAt)
	writeFieldLP(&buf, m.Source)
	if m.Digests == nil {
		writeFieldLP(&buf, "")
		writeFieldLP(&buf, "")
		writeFieldLP(&buf, "")
	} else {
		writeFieldLP(&buf, m.Digests.Before)
		writeFieldLP(&buf, m.Digests.After)
		writeFieldLP(&buf, m.Digests.Result)
	}
	if m.Signer == nil {
		writeFieldLP(&buf, "")
		writeFieldLP(&buf, "")
	} else {
		writeFieldLP(&buf, m.Signer.Alg)
		writeFieldLP(&buf, m.Signer.PublicKey)
	}
	sum := sha256.Sum256(buf.Bytes())
	return sum[:]
}

// DigestSHA256Hex returns "sha256:<hex>" for a byte slice. Used to
// produce manifest.digests.* values.
func DigestSHA256Hex(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	sum := sha256.Sum256(b)
	const hexDigits = "0123456789abcdef"
	out := make([]byte, len(sum)*2)
	for i, c := range sum {
		out[i*2] = hexDigits[c>>4]
		out[i*2+1] = hexDigits[c&0x0f]
	}
	return "sha256:" + string(out)
}

// Fingerprint returns a short stable identifier for the public-key
// bytes — first 16 hex chars of SHA-256(SPKI). Used for human display,
// not security: collisions are computationally infeasible at this length
// for honest fingerprinting but a determined attacker could find one,
// so don't use it as a trust check on its own.
func Fingerprint(spkiBytes []byte) string { return fingerprint(spkiBytes) }

func fingerprint(spkiBytes []byte) string {
	sum := sha256.Sum256(spkiBytes)
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 16)
	for i := 0; i < 8; i++ {
		out[i*2] = hexDigits[sum[i]>>4]
		out[i*2+1] = hexDigits[sum[i]&0x0f]
	}
	return string(out)
}

func verifyDigest(claim string, body []byte, name string) error {
	if claim == "" {
		// No claim means we can't verify, but no claim isn't a corruption
		// either. The caller treats absence of digests as Signed=false.
		return nil
	}
	want := DigestSHA256Hex(body)
	if claim != want {
		return fmt.Errorf("digest mismatch (%s)", name)
	}
	return nil
}

func writeFieldLP(buf *bytes.Buffer, s string) {
	var hdr [8]byte
	binary.BigEndian.PutUint64(hdr[:], uint64(len(s)))
	buf.Write(hdr[:])
	buf.WriteString(s)
}
