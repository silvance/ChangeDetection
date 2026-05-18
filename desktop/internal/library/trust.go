package library

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// TrustedSigner is one entry in the operator's allow-list of producer
// signing keys. Fingerprint is the same lowercase-hex SHA-256 prefix
// produced by evidencepack.Fingerprint and stored on every imported
// scan as SignerFingerprint. The label is whatever the operator wrote
// down to remind themselves which phone the key belongs to.
type TrustedSigner struct {
	Fingerprint string    `json:"fingerprint"`
	Label       string    `json:"label,omitempty"`
	AddedAt     time.Time `json:"addedAt"`
}

// trustFile is the on-disk JSON shape; kept simple so a human can
// audit ~/.pixelsentinel/trust.json by hand.
type trustFile struct {
	Signers []TrustedSigner `json:"signers"`
}

// TrustStore wraps the per-library trusted-signer list. Lives at
// <dataDir>/trust.json. Loaded eagerly by Open; subsequent reads are
// served from memory under a read lock.
type TrustStore struct {
	path string
	mu   sync.RWMutex
	file trustFile
}

// trustPath is split out so the open helper can reach it without
// touching the rest of Library's filesystem layout knowledge.
func (l *Library) trustPath() string { return filepath.Join(l.dir, "trust.json") }

// openTrustStore loads (or initialises) the trust store for a library.
// A missing file is not an error — first run just starts with an empty
// allow-list.
func openTrustStore(path string) (*TrustStore, error) {
	t := &TrustStore{path: path}
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return t, nil
	case err != nil:
		return nil, fmt.Errorf("read trust: %w", err)
	}
	if err := json.Unmarshal(b, &t.file); err != nil {
		return nil, fmt.Errorf("parse trust: %w", err)
	}
	return t, nil
}

// List returns a snapshot of the trusted signers, oldest-first.
func (t *TrustStore) List() []TrustedSigner {
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := make([]TrustedSigner, len(t.file.Signers))
	copy(out, t.file.Signers)
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].AddedAt.Before(out[j].AddedAt)
	})
	return out
}

// IsTrusted reports whether the given fingerprint is on the allow-list.
// Empty input is never trusted (an unsigned pack carries no fingerprint).
func (t *TrustStore) IsTrusted(fingerprint string) bool {
	fp := normaliseFingerprint(fingerprint)
	if fp == "" {
		return false
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	for _, s := range t.file.Signers {
		if s.Fingerprint == fp {
			return true
		}
	}
	return false
}

// Add inserts a fingerprint into the allow-list. Returns the stored
// entry (with its AddedAt timestamp). Duplicate fingerprints update
// the label in place rather than appending a second row, so the file
// stays small even after a lot of editing.
func (t *TrustStore) Add(fingerprint, label string) (*TrustedSigner, error) {
	fp := normaliseFingerprint(fingerprint)
	if fp == "" {
		return nil, errors.New("fingerprint is required")
	}
	if !isValidFingerprint(fp) {
		return nil, errors.New("fingerprint must be lowercase hex, 8-64 chars")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().UTC()
	for i := range t.file.Signers {
		if t.file.Signers[i].Fingerprint == fp {
			t.file.Signers[i].Label = strings.TrimSpace(label)
			if err := t.saveLocked(); err != nil {
				return nil, err
			}
			out := t.file.Signers[i]
			return &out, nil
		}
	}
	entry := TrustedSigner{
		Fingerprint: fp,
		Label:       strings.TrimSpace(label),
		AddedAt:     now,
	}
	t.file.Signers = append(t.file.Signers, entry)
	if err := t.saveLocked(); err != nil {
		return nil, err
	}
	return &entry, nil
}

// Remove deletes a fingerprint from the allow-list. Returns ErrNotFound
// (via errors.Is) when the fingerprint wasn't trusted in the first
// place, which the HTTP layer can map to 404.
func (t *TrustStore) Remove(fingerprint string) error {
	fp := normaliseFingerprint(fingerprint)
	if fp == "" {
		return errors.New("fingerprint is required")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range t.file.Signers {
		if t.file.Signers[i].Fingerprint == fp {
			t.file.Signers = append(t.file.Signers[:i], t.file.Signers[i+1:]...)
			return t.saveLocked()
		}
	}
	return ErrTrustNotFound
}

// ErrTrustNotFound is returned by Remove when no matching entry exists.
var ErrTrustNotFound = errors.New("fingerprint not in trust list")

func (t *TrustStore) saveLocked() error {
	return writeJSONAtomic(t.path, t.file)
}

// normaliseFingerprint lowercases and trims a fingerprint so two equal
// keys with different casing don't end up as separate entries.
func normaliseFingerprint(fp string) string {
	return strings.ToLower(strings.TrimSpace(fp))
}

// isValidFingerprint accepts the truncated 16-hex form Producer/Pack
// signatures use today, plus longer hex strings up to 64 chars in case
// someone pastes a full SHA-256. Anything outside that is rejected.
func isValidFingerprint(fp string) bool {
	if len(fp) < 8 || len(fp) > 64 {
		return false
	}
	for _, c := range fp {
		isDigit := c >= '0' && c <= '9'
		isHex := c >= 'a' && c <= 'f'
		if !isDigit && !isHex {
			return false
		}
	}
	return true
}
