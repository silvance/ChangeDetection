package evidencepack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

// makeUnsignedPack builds a minimal valid pack with whatever manifest the
// caller wants. Used to exercise clamping without dragging signing in.
func makeUnsignedPack(t *testing.T, m Manifest) []byte {
	t.Helper()
	m.Version = 1
	m.Files = FilesIndex{Before: "before.jpg", After: "after.jpg"}

	mb, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w1, _ := zw.Create("manifest.json")
	w1.Write(mb)
	w2, _ := zw.Create("before.jpg")
	w2.Write([]byte("b"))
	w3, _ := zw.Create("after.jpg")
	w3.Write([]byte("a"))
	if err := zw.Close(); err != nil {
		t.Fatalf("zip: %v", err)
	}
	return buf.Bytes()
}

func TestRead_ClampsHostileManifestValues(t *testing.T) {
	hostile := Manifest{
		Label:      "x",
		CapturedAt: "2026-01-01T00:00:00Z",
		Stats: Stats{
			ChangedPct:    999,
			ChangedPixels: -7,
			Regions:       -1,
		},
		Params: Params{
			Strength:       1 << 30,
			MorphSize:      -50,
			CloseSize:      9999,
			MinRegion:      -100,
			PreBlurSigma:   -3,
			HighlightR:     -1,
			HighlightG:     500,
			HighlightB:     256,
			HighlightAlpha: 2,
		},
	}
	pack, err := Read(makeUnsignedPack(t, hostile))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	p := pack.Manifest.Params
	if p.Strength != 100 || p.MorphSize != 0 || p.CloseSize != 50 || p.MinRegion != 0 {
		t.Errorf("params clamp wrong: %+v", p)
	}
	if p.PreBlurSigma != 0 {
		t.Errorf("preBlurSigma not clamped to 0: %v", p.PreBlurSigma)
	}
	if p.HighlightR != 0 || p.HighlightG != 255 || p.HighlightB != 255 {
		t.Errorf("rgb clamp wrong: r=%d g=%d b=%d", p.HighlightR, p.HighlightG, p.HighlightB)
	}
	if p.HighlightAlpha != 1 {
		t.Errorf("alpha clamp wrong: %v", p.HighlightAlpha)
	}
	s := pack.Manifest.Stats
	if s.ChangedPct != 100 || s.ChangedPixels != 0 || s.Regions != 0 {
		t.Errorf("stats clamp wrong: %+v", s)
	}
}

// NaN can't reach us through JSON (Go refuses to marshal it), but the
// defensive path in clampFloat still has to be correct in case anything
// ever constructs a Manifest in-memory and runs it through clampManifest.
func TestClampFloat_HandlesNaN(t *testing.T) {
	if got := clampFloat(math.NaN(), 0, 1); got != 0 {
		t.Errorf("NaN clamp got %v, want 0", got)
	}
	if got := clampFloat(math.Inf(1), 0, 1); got != 1 {
		t.Errorf("+Inf clamp got %v, want 1", got)
	}
	if got := clampFloat(math.Inf(-1), 0, 1); got != 0 {
		t.Errorf("-Inf clamp got %v, want 0", got)
	}
}
