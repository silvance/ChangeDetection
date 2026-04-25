// Package evidencepack defines and parses the PixelSentinel "Evidence
// Pack v1" interchange format.
//
// An Evidence Pack is a single ZIP file produced by the phone client when
// sharing a saved scan to the desktop. It contains:
//
//	manifest.json     mandatory; metadata describing the scan
//	before.jpg        mandatory
//	after.jpg         mandatory
//	result.png        optional; the rendered analysis highlight
//
// The format is intentionally minimal — just JSON + standard image files —
// so the desktop tool can read packs that were transferred over LAN, USB,
// AirDrop, email, or anything else without caring how they got here.
package evidencepack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Version is the schema version we currently emit and accept.
const Version = 1

// Manifest is the JSON payload at manifest.json inside an Evidence Pack.
//
// Schema is intentionally flat. Times are RFC3339 strings.
type Manifest struct {
	Version    int        `json:"version"`
	ScanID     string     `json:"scanId,omitempty"`
	Label      string     `json:"label"`
	CapturedAt string     `json:"capturedAt"`           // RFC3339 in UTC
	Source     string     `json:"source,omitempty"`     // "phone:android" etc.
	Stats      Stats      `json:"stats"`
	Params     Params     `json:"params"`
	Warp       *Warp      `json:"warp,omitempty"`
	Files      FilesIndex `json:"files"`
}

// Stats mirrors the imgproc.Stats / Android AnalysisState.Success numbers.
type Stats struct {
	ChangedPct    float64 `json:"changedPct"`
	ChangedPixels int     `json:"changedPixels"`
	Regions       int     `json:"regions"`
}

// Params records the analysis settings that produced the result image, so
// the desktop can reproduce it exactly.
type Params struct {
	Strength       int     `json:"strength"`
	MorphSize      int     `json:"morphSize"`
	CloseSize      int     `json:"closeSize"`
	MinRegion      int     `json:"minRegion"`
	PreBlurSigma   float64 `json:"preBlurSigma"`
	NormalizeLuma  bool    `json:"normalizeLuma"`
	HighlightR     int     `json:"highlightR"`
	HighlightG     int     `json:"highlightG"`
	HighlightB     int     `json:"highlightB"`
	HighlightAlpha float64 `json:"highlightAlpha"`
}

// Warp records the manual point-pair alignment (if any) that was used.
type Warp struct {
	Src [][]float64 `json:"src"` // each element is [x, y] in source pixels
	Dst [][]float64 `json:"dst"`
}

// FilesIndex names the image files that the pack carries. Names are
// relative to the zip root.
type FilesIndex struct {
	Before string `json:"before"`
	After  string `json:"after"`
	Result string `json:"result,omitempty"`
}

// ── Reader ─────────────────────────────────────────────────────────────────

// Pack is a parsed Evidence Pack held in memory. The image fields are the
// raw file bytes (JPEG/PNG); they are not decoded here.
type Pack struct {
	Manifest  Manifest
	BeforeJPG []byte
	AfterJPG  []byte
	ResultPNG []byte // nil when the pack didn't include a result
}

// MaxSize caps the bytes we'll read out of a pack. Phones that produce
// 50MB+ packs are real; anything past this is almost certainly malicious.
const MaxSize = 200 * 1024 * 1024

// Read parses an Evidence Pack from a zip-encoded byte slice.
func Read(zipBytes []byte) (*Pack, error) {
	if len(zipBytes) == 0 {
		return nil, errors.New("empty pack")
	}
	if len(zipBytes) > MaxSize {
		return nil, fmt.Errorf("pack too large: %d bytes (max %d)", len(zipBytes), MaxSize)
	}
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("not a valid zip: %w", err)
	}

	files := map[string][]byte{}
	for _, f := range zr.File {
		// Reject path traversal: an evidence pack is flat by design.
		if f.Name != cleanName(f.Name) {
			return nil, fmt.Errorf("rejected suspicious entry %q", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open %q: %w", f.Name, err)
		}
		b, err := io.ReadAll(io.LimitReader(rc, MaxSize))
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read %q: %w", f.Name, err)
		}
		files[f.Name] = b
	}

	manifestBytes, ok := files["manifest.json"]
	if !ok {
		return nil, errors.New("missing manifest.json")
	}
	var m Manifest
	if err := json.Unmarshal(manifestBytes, &m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	if m.Version != Version {
		return nil, fmt.Errorf("unsupported pack version %d (want %d)", m.Version, Version)
	}
	if m.Files.Before == "" || m.Files.After == "" {
		return nil, errors.New("manifest missing before/after file names")
	}

	beforeBytes, ok := files[m.Files.Before]
	if !ok {
		return nil, fmt.Errorf("missing before image %q", m.Files.Before)
	}
	afterBytes, ok := files[m.Files.After]
	if !ok {
		return nil, fmt.Errorf("missing after image %q", m.Files.After)
	}
	var resultBytes []byte
	if m.Files.Result != "" {
		resultBytes, ok = files[m.Files.Result]
		if !ok {
			return nil, fmt.Errorf("missing result image %q", m.Files.Result)
		}
	}

	return &Pack{
		Manifest:  m,
		BeforeJPG: beforeBytes,
		AfterJPG:  afterBytes,
		ResultPNG: resultBytes,
	}, nil
}

// cleanName trims any leading "./" and rejects anything containing ".." or
// a slash; an Evidence Pack is required to be flat (no subdirectories).
func cleanName(name string) string {
	for len(name) > 1 && name[:2] == "./" {
		name = name[2:]
	}
	for _, r := range name {
		if r == '/' || r == '\\' {
			return "_invalid_"
		}
	}
	if name == ".." || name == "." {
		return "_invalid_"
	}
	return name
}
