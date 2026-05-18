package v1

import "testing"

// Loopback gating must look at the raw TCP peer (RemoteAddr), not Gin's
// ClientIP (which honours X-Forwarded-For). Anyone on the LAN could send
// "X-Forwarded-For: 127.0.0.1" and bypass the pairing-token check otherwise.
func TestRemoteHostIgnoresHeaderSpoofing(t *testing.T) {
	cases := []struct {
		remoteAddr string
		wantHost   string
		wantLocal  bool
	}{
		{"127.0.0.1:54321", "127.0.0.1", true},
		{"[::1]:54321", "::1", true},
		{"192.168.1.50:54321", "192.168.1.50", false},
		{"10.0.0.5:80", "10.0.0.5", false},
		{"", "", false},
	}
	for _, tc := range cases {
		got := remoteHost(tc.remoteAddr)
		if got != tc.wantHost {
			t.Errorf("remoteHost(%q) = %q, want %q", tc.remoteAddr, got, tc.wantHost)
		}
		if isLoopback(got) != tc.wantLocal {
			t.Errorf("isLoopback(%q) = %v, want %v", got, !tc.wantLocal, tc.wantLocal)
		}
	}
}
