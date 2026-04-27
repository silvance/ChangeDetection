package evidencepack

import (
	"archive/zip"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// signedTestPack synthesises a valid signed pack from a freshly
// generated keypair. Used by all tests that need a known-good baseline.
func signedTestPack(t *testing.T) (zipBytes []byte, priv *ecdsa.PrivateKey) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	spki, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal pub: %v", err)
	}
	pubB64 := base64.StdEncoding.EncodeToString(spki)

	beforeJPG := []byte("fake-jpeg-before-bytes")
	afterJPG := []byte("fake-jpeg-after-bytes")

	m := Manifest{
		Version:    1,
		Label:      "Test scan",
		CapturedAt: "2026-04-26T12:00:00Z",
		Source:     "test:unit",
		Stats:      Stats{ChangedPct: 1, ChangedPixels: 1, Regions: 1},
		Params:     Params{Strength: 75, MorphSize: 7, CloseSize: 5, MinRegion: 25, PreBlurSigma: 2, NormalizeLuma: true, HighlightR: 255, HighlightG: 60, HighlightB: 60, HighlightAlpha: 0.55},
		Files:      FilesIndex{Before: "before.jpg", After: "after.jpg"},
		Digests: &Digests{
			Before: DigestSHA256Hex(beforeJPG),
			After:  DigestSHA256Hex(afterJPG),
		},
		Signer: &Signer{Alg: AlgECDSAP256SHA256, PublicKey: pubB64},
	}

	digest := SigningDigest(m)
	sig, err := ecdsa.SignASN1(rand.Reader, priv, digest)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	m.Signature = base64.StdEncoding.EncodeToString(sig)

	mb, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w1, _ := zw.Create("manifest.json")
	w1.Write(mb)
	w2, _ := zw.Create("before.jpg")
	w2.Write(beforeJPG)
	w3, _ := zw.Create("after.jpg")
	w3.Write(afterJPG)
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes(), priv
}

func TestVerify_GoodSignedPack(t *testing.T) {
	zipBytes, _ := signedTestPack(t)

	pack, err := Read(zipBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	got, err := Verify(pack)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !got.Signed || !got.Verified {
		t.Fatalf("want signed+verified; got %+v", got)
	}
	if got.SignerFingerprint == "" {
		t.Fatalf("want non-empty fingerprint")
	}
}

func TestVerify_TamperedFileBytes(t *testing.T) {
	zipBytes, _ := signedTestPack(t)

	// Rebuild the zip with the before.jpg bytes mutated. Manifest digest
	// claim is unchanged, so digest verification should reject.
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatalf("zip read: %v", err)
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range r.File {
		w, _ := zw.Create(f.Name)
		rc, _ := f.Open()
		buf := new(bytes.Buffer)
		buf.ReadFrom(rc)
		rc.Close()
		body := buf.Bytes()
		if f.Name == "before.jpg" {
			body = []byte("tampered-bytes")
		}
		w.Write(body)
	}
	zw.Close()

	pack, err := Read(out.Bytes())
	if err != nil {
		t.Fatalf("read tampered: %v", err)
	}
	got, _ := Verify(pack)
	if got.Verified {
		t.Fatalf("tampered pack should not verify; got %+v", got)
	}
	if !strings.Contains(got.Reason, "before") {
		t.Fatalf("want reason mentioning 'before', got %q", got.Reason)
	}
}

func TestVerify_TamperedSignature(t *testing.T) {
	zipBytes, _ := signedTestPack(t)
	pack, err := Read(zipBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	// Flip the last byte of the signature.
	sig, _ := base64.StdEncoding.DecodeString(pack.Manifest.Signature)
	sig[len(sig)-1] ^= 0x01
	pack.Manifest.Signature = base64.StdEncoding.EncodeToString(sig)

	got, _ := Verify(pack)
	if got.Verified {
		t.Fatalf("tampered signature should not verify; got %+v", got)
	}
	if !strings.Contains(got.Reason, "mismatch") {
		t.Fatalf("want 'mismatch' in reason, got %q", got.Reason)
	}
}

func TestVerify_TamperedDigestClaim(t *testing.T) {
	zipBytes, _ := signedTestPack(t)
	pack, err := Read(zipBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	// Replace the digest claim — the claim no longer matches the bytes.
	pack.Manifest.Digests.Before = "sha256:" + strings.Repeat("ff", 32)

	got, _ := Verify(pack)
	if got.Verified {
		t.Fatalf("bad digest should not verify; got %+v", got)
	}
}

func TestVerify_WrongAlgorithm(t *testing.T) {
	zipBytes, _ := signedTestPack(t)
	pack, err := Read(zipBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pack.Manifest.Signer.Alg = "rsa-pkcs1-sha512"

	got, _ := Verify(pack)
	if got.Verified {
		t.Fatalf("wrong alg should not verify; got %+v", got)
	}
	if !strings.Contains(got.Reason, "unsupported") {
		t.Fatalf("want 'unsupported' in reason, got %q", got.Reason)
	}
}

func TestVerify_UnsignedAccepted(t *testing.T) {
	// Build an unsigned pack — older phone clients still produce these.
	beforeJPG := []byte("a")
	afterJPG := []byte("b")
	m := Manifest{
		Version:    1,
		Label:      "Unsigned scan",
		CapturedAt: "2026-04-26T12:00:00Z",
		Files:      FilesIndex{Before: "before.jpg", After: "after.jpg"},
	}
	mb, _ := json.Marshal(m)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w1, _ := zw.Create("manifest.json")
	w1.Write(mb)
	w2, _ := zw.Create("before.jpg")
	w2.Write(beforeJPG)
	w3, _ := zw.Create("after.jpg")
	w3.Write(afterJPG)
	zw.Close()

	pack, err := Read(buf.Bytes())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	got, _ := Verify(pack)
	if got.Signed {
		t.Fatalf("unsigned pack should not be Signed=true; got %+v", got)
	}
	if got.Verified {
		t.Fatalf("unsigned pack should not be Verified=true; got %+v", got)
	}
}

func TestVerify_BadPublicKey(t *testing.T) {
	zipBytes, _ := signedTestPack(t)
	pack, err := Read(zipBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pack.Manifest.Signer.PublicKey = "not!base64!@#"

	got, _ := Verify(pack)
	if got.Verified {
		t.Fatalf("bad key should not verify; got %+v", got)
	}
	if !strings.Contains(got.Reason, "base64") {
		t.Fatalf("want 'base64' in reason, got %q", got.Reason)
	}
}

func TestFingerprintStable(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	spki, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	a := Fingerprint(spki)
	b := Fingerprint(spki)
	if a != b || len(a) != 16 {
		t.Fatalf("fingerprint not stable / not 16 chars: a=%q b=%q", a, b)
	}
}
