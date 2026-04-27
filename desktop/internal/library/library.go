// Package library is PixelSentinel's on-disk evidence library.
//
// Layout under the data directory:
//
//	<data>/config.json          server config (pairing token, etc.)
//	<data>/cases/<case-id>/meta.json
//	<data>/cases/<case-id>/scans/<scan-id>/manifest.json
//	<data>/cases/<case-id>/scans/<scan-id>/{before,after,result}.{jpg,png}
//
// Single-process for now: a process-wide RWMutex serialises writes. There's
// no SQLite/BoltDB dependency on purpose — a flat-file layout keeps the
// binary self-contained and the data trivially auditable from the shell
// (which matters for an evidence tool).
package library

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ── On-disk types ──────────────────────────────────────────────────────────

// Case groups related scans (typically one TSCM sweep).
type Case struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Notes     string    `json:"notes,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CaseSummary is a Case plus a derived scan count, returned by listings.
type CaseSummary struct {
	Case
	ScanCount int `json:"scanCount"`
}

// Scan is a single before/after/result triple inside a case, usually imported
// from the phone client as an Evidence Pack.
type Scan struct {
	ID         string     `json:"id"`
	CaseID     string     `json:"caseId"`
	Label      string     `json:"label"`
	// Target groups scans of the same physical place across visits, so the
	// time-series view can stack them. Empty string is treated as
	// "Untagged" by the UI. Operators set it on the desktop after import.
	Target     string     `json:"target,omitempty"`
	CapturedAt time.Time  `json:"capturedAt"`
	ImportedAt time.Time  `json:"importedAt"`
	Source     string     `json:"source"`           // e.g. "phone:android"
	Stats      ScanStats  `json:"stats"`
	Params     ScanParams `json:"params"`
	Files      ScanFiles  `json:"files"`

	// ── Tamper-evident hash chain (filled by AddScan) ─────────────────────
	// ContentHash is the SHA-256 of the canonical content of this scan
	// (before|after|result bytes concatenated in order). PrevHash is the
	// ContentHash of the previous scan in the same case (newest-first
	// chronological lookup), or empty for the first scan in a case.
	ContentHash string `json:"contentHash"`
	PrevHash    string `json:"prevHash,omitempty"`
}

// ScanStats mirrors the analysis numbers produced by the imgproc core.
type ScanStats struct {
	ChangedPct    float64 `json:"changedPct"`
	ChangedPixels int     `json:"changedPixels"`
	Regions       int     `json:"regions"`
}

// ScanParams are the analysis parameters that were used to produce Stats /
// the result image. Stored so the desktop can later re-run the same scan
// reproducibly.
type ScanParams struct {
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

// ScanFiles records the on-disk files for a scan. Names are relative to the
// scan's directory.
type ScanFiles struct {
	Before string  `json:"before"`
	After  string  `json:"after"`
	Result *string `json:"result,omitempty"`
}

// ── Server config ──────────────────────────────────────────────────────────

type config struct {
	PairingToken string `json:"pairingToken"`
}

// ── Library type ───────────────────────────────────────────────────────────

// Library is a process-wide handle to the on-disk store. Open() returns one;
// callers should keep the same Library for the life of the server.
type Library struct {
	dir string
	mu  sync.RWMutex
	cfg config
}

// Open initialises (or loads) a library rooted at dir.
func Open(dir string) (*Library, error) {
	if err := os.MkdirAll(filepath.Join(dir, "cases"), 0o755); err != nil {
		return nil, fmt.Errorf("create cases dir: %w", err)
	}
	l := &Library{dir: dir}
	if err := l.loadOrInitConfig(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *Library) loadOrInitConfig() error {
	path := filepath.Join(l.dir, "config.json")
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		tok, err := generateToken()
		if err != nil {
			return err
		}
		l.cfg = config{PairingToken: tok}
		return l.saveConfig()
	case err != nil:
		return fmt.Errorf("read config: %w", err)
	}
	if err := json.Unmarshal(b, &l.cfg); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	if l.cfg.PairingToken == "" {
		tok, err := generateToken()
		if err != nil {
			return err
		}
		l.cfg.PairingToken = tok
		return l.saveConfig()
	}
	return nil
}

func (l *Library) saveConfig() error {
	return writeJSONAtomic(filepath.Join(l.dir, "config.json"), l.cfg)
}

// PairingToken returns the static token a phone client must present to
// import an Evidence Pack. Treat it like a password.
func (l *Library) PairingToken() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.cfg.PairingToken
}

// ── Cases ──────────────────────────────────────────────────────────────────

func (l *Library) casesDir() string { return filepath.Join(l.dir, "cases") }
func (l *Library) caseDir(id string) string {
	return filepath.Join(l.casesDir(), id)
}
func (l *Library) caseMetaPath(id string) string {
	return filepath.Join(l.caseDir(id), "meta.json")
}
func (l *Library) caseScansDir(id string) string {
	return filepath.Join(l.caseDir(id), "scans")
}

// CreateCase creates a new empty case with a freshly generated UUID.
func (l *Library) CreateCase(name, notes string) (*Case, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now().UTC()
	c := &Case{
		ID:        uuid.NewString(),
		Name:      name,
		Notes:     notes,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := os.MkdirAll(l.caseScansDir(c.ID), 0o755); err != nil {
		return nil, err
	}
	if err := writeJSONAtomic(l.caseMetaPath(c.ID), c); err != nil {
		return nil, err
	}
	return c, nil
}

// ListCases returns all cases sorted newest-first by UpdatedAt.
func (l *Library) ListCases() ([]CaseSummary, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	entries, err := os.ReadDir(l.casesDir())
	if err != nil {
		return nil, err
	}
	out := make([]CaseSummary, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		c, err := l.readCaseLocked(e.Name())
		if err != nil {
			continue // skip corrupt entries
		}
		count, _ := l.countScansLocked(c.ID)
		out = append(out, CaseSummary{Case: *c, ScanCount: count})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

// GetCase returns the case with the given ID.
func (l *Library) GetCase(id string) (*Case, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.readCaseLocked(id)
}

func (l *Library) readCaseLocked(id string) (*Case, error) {
	b, err := os.ReadFile(l.caseMetaPath(id))
	if err != nil {
		return nil, err
	}
	var c Case
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// DeleteCase removes a case and all of its scans. There is no trash —
// callers should confirm with the user first.
func (l *Library) DeleteCase(id string) error {
	if id == "" {
		return errors.New("empty case id")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return os.RemoveAll(l.caseDir(id))
}

func (l *Library) touchCaseLocked(id string) error {
	c, err := l.readCaseLocked(id)
	if err != nil {
		return err
	}
	c.UpdatedAt = time.Now().UTC()
	return writeJSONAtomic(l.caseMetaPath(id), c)
}

// ── Scans ──────────────────────────────────────────────────────────────────

func (l *Library) scanDir(caseID, scanID string) string {
	return filepath.Join(l.caseScansDir(caseID), scanID)
}
func (l *Library) scanManifestPath(caseID, scanID string) string {
	return filepath.Join(l.scanDir(caseID, scanID), "manifest.json")
}

// ScanFiles is the set of bytes a caller hands to AddScan when importing.
// The result is optional.
type ScanInputFiles struct {
	BeforeJPG []byte
	AfterJPG  []byte
	ResultPNG []byte // may be nil
}

// AddScan persists a new scan into the given case. Computes the
// content hash and chains it to the previous scan in the case so the
// resulting library is tamper-evident: changing any saved bytes or
// reordering scans within a case will break the chain.
func (l *Library) AddScan(caseID string, s Scan, files ScanInputFiles) (*Scan, error) {
	if caseID == "" {
		return nil, errors.New("empty case id")
	}
	if len(files.BeforeJPG) == 0 || len(files.AfterJPG) == 0 {
		return nil, errors.New("before and after images are required")
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if _, err := l.readCaseLocked(caseID); err != nil {
		return nil, fmt.Errorf("case not found: %w", err)
	}

	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	s.CaseID = caseID
	if s.ImportedAt.IsZero() {
		s.ImportedAt = time.Now().UTC()
	}
	if s.CapturedAt.IsZero() {
		s.CapturedAt = s.ImportedAt
	}
	if s.Source == "" {
		s.Source = "unknown"
	}

	// Compute the content hash before persisting anything: this is what
	// the chain commits to.
	s.ContentHash = computeContentHash(files.BeforeJPG, files.AfterJPG, files.ResultPNG)

	// Chain to the most recently *imported* prior scan in this case.
	// ImportedAt is set here on the server, so it's monotonic and
	// unambiguous (CapturedAt comes from the phone and can collide).
	if prev, err := l.scansByImportLocked(caseID); err == nil && len(prev) > 0 {
		s.PrevHash = prev[len(prev)-1].ContentHash
	}

	scanDir := l.scanDir(caseID, s.ID)
	if err := os.MkdirAll(scanDir, 0o755); err != nil {
		return nil, err
	}

	if err := os.WriteFile(filepath.Join(scanDir, "before.jpg"), files.BeforeJPG, 0o644); err != nil {
		return nil, err
	}
	s.Files.Before = "before.jpg"

	if err := os.WriteFile(filepath.Join(scanDir, "after.jpg"), files.AfterJPG, 0o644); err != nil {
		return nil, err
	}
	s.Files.After = "after.jpg"

	if len(files.ResultPNG) > 0 {
		if err := os.WriteFile(filepath.Join(scanDir, "result.png"), files.ResultPNG, 0o644); err != nil {
			return nil, err
		}
		name := "result.png"
		s.Files.Result = &name
	}

	if err := writeJSONAtomic(l.scanManifestPath(caseID, s.ID), s); err != nil {
		return nil, err
	}

	if err := l.touchCaseLocked(caseID); err != nil {
		// Non-fatal: the scan is on disk, just couldn't bump the case mtime.
		fmt.Fprintf(os.Stderr, "pixelsentinel: touch case %s: %v\n", caseID, err)
	}
	return &s, nil
}

// computeContentHash is the canonical hash function for a scan's content.
// Order matters: before, after, then result (if present). Length-prefixing
// each section means concatenation can't be confused (i.e. a scan with
// before=AB,after=C and one with before=A,after=BC don't collide).
func computeContentHash(beforeJPG, afterJPG, resultPNG []byte) string {
	h := sha256.New()
	writeLengthPrefixed(h, beforeJPG)
	writeLengthPrefixed(h, afterJPG)
	if len(resultPNG) > 0 {
		writeLengthPrefixed(h, resultPNG)
	} else {
		// Marker for "no result" so a missing result is distinguishable
		// from a zero-byte one.
		writeLengthPrefixed(h, nil)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func writeLengthPrefixed(w io.Writer, b []byte) {
	var hdr [8]byte
	n := uint64(len(b))
	for i := 0; i < 8; i++ {
		hdr[i] = byte(n >> (8 * (7 - i)))
	}
	w.Write(hdr[:])
	w.Write(b)
}

// ListScans returns all scans in a case sorted newest-first by CapturedAt.
func (l *Library) ListScans(caseID string) ([]Scan, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.listScansLocked(caseID)
}

// scansByImportLocked returns scans for a case sorted by ImportedAt
// ascending (oldest-first). Used for hash-chain construction and ledger
// rendering — both depend on a deterministic, server-controlled order
// that listScansLocked (sorted by CapturedAt for display) cannot give.
func (l *Library) scansByImportLocked(caseID string) ([]Scan, error) {
	scans, err := l.listScansLocked(caseID)
	if err != nil {
		return nil, err
	}
	out := make([]Scan, len(scans))
	copy(out, scans)
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].ImportedAt.Equal(out[j].ImportedAt) {
			return out[i].ImportedAt.Before(out[j].ImportedAt)
		}
		// Tie-break by ID so the order is deterministic across processes.
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (l *Library) listScansLocked(caseID string) ([]Scan, error) {
	entries, err := os.ReadDir(l.caseScansDir(caseID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]Scan, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		s, err := l.readScanLocked(caseID, e.Name())
		if err != nil {
			continue
		}
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CapturedAt.After(out[j].CapturedAt)
	})
	return out, nil
}

func (l *Library) countScansLocked(caseID string) (int, error) {
	entries, err := os.ReadDir(l.caseScansDir(caseID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if e.IsDir() {
			n++
		}
	}
	return n, nil
}

// GetScan returns a scan by id.
func (l *Library) GetScan(caseID, scanID string) (*Scan, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.readScanLocked(caseID, scanID)
}

func (l *Library) readScanLocked(caseID, scanID string) (*Scan, error) {
	b, err := os.ReadFile(l.scanManifestPath(caseID, scanID))
	if err != nil {
		return nil, err
	}
	var s Scan
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// ScanFilePath returns an absolute path to a file inside a scan, refusing
// any path that would escape the scan dir.
func (l *Library) ScanFilePath(caseID, scanID, name string) (string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	cleaned := filepath.Clean(name)
	if cleaned != filepath.Base(cleaned) || cleaned == "." || cleaned == ".." {
		return "", errors.New("invalid file name")
	}
	return filepath.Join(l.scanDir(caseID, scanID), cleaned), nil
}

// LedgerEntry is one row of the verifiable hash chain for a case.
type LedgerEntry struct {
	ScanID       string    `json:"scanId"`
	Label        string    `json:"label"`
	CapturedAt   time.Time `json:"capturedAt"`
	ContentHash  string    `json:"contentHash"`
	PrevHash     string    `json:"prevHash,omitempty"`
	Verified     bool      `json:"verified"`
	VerifyError  string    `json:"verifyError,omitempty"`
	ChainBroken  bool      `json:"chainBroken,omitempty"`
}

// Ledger returns the full verifiable hash chain for a case in import order
// (oldest-first), recomputing each scan's contentHash from the bytes on
// disk and checking that the chain's prevHash links match.
func (l *Library) Ledger(caseID string) ([]LedgerEntry, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	chrono, err := l.scansByImportLocked(caseID)
	if err != nil {
		return nil, err
	}

	out := make([]LedgerEntry, 0, len(chrono))
	expectedPrev := ""
	for _, s := range chrono {
		entry := LedgerEntry{
			ScanID:      s.ID,
			Label:       s.Label,
			CapturedAt:  s.CapturedAt,
			ContentHash: s.ContentHash,
			PrevHash:    s.PrevHash,
		}

		// Recompute the content hash from the actual files on disk.
		beforePath := filepath.Join(l.scanDir(caseID, s.ID), s.Files.Before)
		afterPath := filepath.Join(l.scanDir(caseID, s.ID), s.Files.After)
		var resultBytes []byte
		if s.Files.Result != nil && *s.Files.Result != "" {
			resultBytes, _ = os.ReadFile(filepath.Join(l.scanDir(caseID, s.ID), *s.Files.Result))
		}
		beforeBytes, errB := os.ReadFile(beforePath)
		afterBytes, errA := os.ReadFile(afterPath)
		switch {
		case errB != nil:
			entry.VerifyError = "before missing: " + errB.Error()
		case errA != nil:
			entry.VerifyError = "after missing: " + errA.Error()
		default:
			recomputed := computeContentHash(beforeBytes, afterBytes, resultBytes)
			entry.Verified = recomputed == s.ContentHash
			if !entry.Verified {
				entry.VerifyError = "content hash mismatch"
			}
		}

		if s.PrevHash != expectedPrev {
			entry.ChainBroken = true
		}
		expectedPrev = s.ContentHash

		out = append(out, entry)
	}
	return out, nil
}

// ScanMetaPatch is the set of editable scan fields. nil = leave unchanged.
type ScanMetaPatch struct {
	Label  *string
	Target *string
}

// UpdateScanMeta edits a scan's user-facing metadata (label / target).
// Content-bearing fields (files, params, hashes, timestamps) are
// immutable from this entry point — changing them would invalidate the
// chain of custody.
func (l *Library) UpdateScanMeta(caseID, scanID string, patch ScanMetaPatch) (*Scan, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	s, err := l.readScanLocked(caseID, scanID)
	if err != nil {
		return nil, err
	}
	if patch.Label != nil {
		s.Label = *patch.Label
	}
	if patch.Target != nil {
		s.Target = *patch.Target
	}
	if err := writeJSONAtomic(l.scanManifestPath(caseID, scanID), s); err != nil {
		return nil, err
	}
	_ = l.touchCaseLocked(caseID)
	return s, nil
}

// DeleteScan removes a scan and its files.
func (l *Library) DeleteScan(caseID, scanID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.RemoveAll(l.scanDir(caseID, scanID)); err != nil {
		return err
	}
	_ = l.touchCaseLocked(caseID)
	return nil
}

// ── Helpers ────────────────────────────────────────────────────────────────

func writeJSONAtomic(path string, v any) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	enc := json.NewEncoder(tmp)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, path)
}

func generateToken() (string, error) {
	var b [24]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
