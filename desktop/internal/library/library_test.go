package library

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// AddScan must be atomic: from the outside the scan exists either in
// full or not at all. We can't easily crash mid-import in-process, but
// we can verify the *visible* state after a successful import is sane
// and that any leftover ".staging-*" dirs are ignored by listings.
func TestAddScanAtomicAndStagingIgnored(t *testing.T) {
	dir := t.TempDir()
	lib, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	cs, err := lib.CreateCase("Atomic", "")
	if err != nil {
		t.Fatalf("CreateCase: %v", err)
	}

	// Plant a fake leftover staging dir that looks plausible. Listing
	// must skip it; the startup sweep would also have removed it (but we
	// didn't reopen the library after planting).
	scansDir := filepath.Join(dir, "cases", cs.ID, "scans")
	if err := os.MkdirAll(filepath.Join(scansDir, ".staging-leftover"), 0o755); err != nil {
		t.Fatalf("mkdir staging: %v", err)
	}
	// Even with a manifest in it, it must stay invisible — the directory
	// name is what marks it as in-flight, not the contents.
	if err := os.WriteFile(filepath.Join(scansDir, ".staging-leftover", "manifest.json"),
		[]byte(`{"id":"x","label":"ghost"}`), 0o644); err != nil {
		t.Fatalf("write fake manifest: %v", err)
	}

	scans, err := lib.ListScans(cs.ID)
	if err != nil {
		t.Fatalf("ListScans: %v", err)
	}
	if len(scans) != 0 {
		t.Fatalf("staging dir leaked into ListScans: %+v", scans)
	}
	count, err := lib.countScansLocked(cs.ID)
	if err != nil {
		t.Fatalf("countScansLocked: %v", err)
	}
	if count != 0 {
		t.Fatalf("staging dir leaked into count: %d", count)
	}

	added, err := lib.AddScan(cs.ID, Scan{Label: "test"}, ScanInputFiles{
		BeforeJPG: []byte("jpegA"),
		AfterJPG:  []byte("jpegB"),
		ResultPNG: []byte("pngR"),
	})
	if err != nil {
		t.Fatalf("AddScan: %v", err)
	}

	// Final dir must hold all four files.
	finalDir := filepath.Join(scansDir, added.ID)
	for _, name := range []string{"before.jpg", "after.jpg", "result.png", "manifest.json"} {
		if _, err := os.Stat(filepath.Join(finalDir, name)); err != nil {
			t.Errorf("missing %s in final scan dir: %v", name, err)
		}
	}

	// And no staging dir from the successful import should remain.
	entries, _ := os.ReadDir(scansDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".staging-") && e.Name() != ".staging-leftover" {
			t.Errorf("AddScan left behind a staging dir: %s", e.Name())
		}
	}

	// Reopening the library should sweep ".staging-leftover".
	if _, err := Open(dir); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if _, err := os.Stat(filepath.Join(scansDir, ".staging-leftover")); !os.IsNotExist(err) {
		t.Errorf("startup sweep did not remove .staging-leftover (err=%v)", err)
	}
}

// Re-importing a scan with the same ID must be rejected, not silently
// overwrite the existing scan (which would break the chain of custody).
func TestAddScanRejectsDuplicateID(t *testing.T) {
	dir := t.TempDir()
	lib, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	cs, err := lib.CreateCase("Dup", "")
	if err != nil {
		t.Fatalf("CreateCase: %v", err)
	}
	first, err := lib.AddScan(cs.ID, Scan{ID: "fixed-id", Label: "first"}, ScanInputFiles{
		BeforeJPG: []byte("a"),
		AfterJPG:  []byte("b"),
	})
	if err != nil {
		t.Fatalf("first AddScan: %v", err)
	}
	if first.ID != "fixed-id" {
		t.Fatalf("expected fixed-id, got %q", first.ID)
	}
	_, err = lib.AddScan(cs.ID, Scan{ID: "fixed-id", Label: "second"}, ScanInputFiles{
		BeforeJPG: []byte("c"),
		AfterJPG:  []byte("d"),
	})
	if err == nil {
		t.Fatal("expected duplicate-id AddScan to fail, got nil")
	}
	if !errors.Is(err, ErrScanExists) {
		t.Errorf("expected ErrScanExists, got %v", err)
	}
}
