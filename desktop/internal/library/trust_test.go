package library

import (
	"path/filepath"
	"testing"
)

func TestTrustStore_AddListRemove(t *testing.T) {
	dir := t.TempDir()
	ts, err := openTrustStore(filepath.Join(dir, "trust.json"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if got := ts.List(); len(got) != 0 {
		t.Fatalf("expected empty list, got %v", got)
	}
	if ts.IsTrusted("abcd1234abcd1234") {
		t.Fatal("empty store should not trust anything")
	}

	if _, err := ts.Add("ABCD1234abcd1234", "John's phone"); err != nil {
		t.Fatalf("add: %v", err)
	}
	// Same fingerprint, different case → same entry (label updated).
	if _, err := ts.Add("abcd1234abcd1234", "John's phone (relabelled)"); err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if got := len(ts.List()); got != 1 {
		t.Fatalf("expected 1 entry after re-add, got %d", got)
	}
	if !ts.IsTrusted("abcd1234abcd1234") {
		t.Fatal("Add should have made the fingerprint trusted")
	}
	if !ts.IsTrusted("ABCD1234ABCD1234") {
		t.Fatal("IsTrusted should be case-insensitive")
	}

	// Persistence: a fresh store opened on the same file sees the
	// same data.
	ts2, err := openTrustStore(filepath.Join(dir, "trust.json"))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !ts2.IsTrusted("abcd1234abcd1234") {
		t.Fatal("trust did not persist across reopen")
	}
	if ts2.List()[0].Label != "John's phone (relabelled)" {
		t.Fatalf("label did not persist: %+v", ts2.List()[0])
	}

	if err := ts2.Remove("abcd1234abcd1234"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if ts2.IsTrusted("abcd1234abcd1234") {
		t.Fatal("Remove should have un-trusted the fingerprint")
	}
	if err := ts2.Remove("abcd1234abcd1234"); err != ErrTrustNotFound {
		t.Fatalf("expected ErrTrustNotFound, got %v", err)
	}
}

func TestTrustStore_RejectsBadFingerprint(t *testing.T) {
	ts, _ := openTrustStore(filepath.Join(t.TempDir(), "trust.json"))
	cases := []string{
		"",         // empty
		"  ",       // whitespace only
		"deadbe",   // too short
		"deadbeef" + "deadbeef" + "deadbeef" + "deadbeef" + "deadbeef" + "deadbeef" + "deadbeef" + "deadbeef" + "x", // too long
		"deadbeefdeadbeefz", // non-hex
		"DEADBEEFDEADBEE!",  // punctuation
	}
	for _, fp := range cases {
		if _, err := ts.Add(fp, ""); err == nil {
			t.Errorf("expected Add(%q) to fail validation", fp)
		}
	}
}
