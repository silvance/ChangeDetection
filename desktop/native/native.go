//go:build native

// Package main is the native-shell PixelSentinel binary.
//
// It runs the existing headless `pixelsentinel` binary as a subprocess
// (on a random loopback port) and opens an OS-native WebView window
// pointed at it. From the user's perspective it looks like a normal
// desktop application — no browser tab, no localhost URL bar — while
// reusing 100% of the headless build's frontend, API and library code.
//
// This file is gated by the `native` build tag because it depends on
// github.com/webview/webview_go, which requires CGO and the platform's
// WebView toolkit (WebKit2GTK on Linux, WebView2 on Windows, native
// WKWebView on macOS). The default `go build ./...` skips it so the
// headless server stays trivially cross-compilable.
//
// Build:
//
//	# pull webview_go into go.mod (only needed once after this file is added)
//	go mod tidy -tags native
//
//	# Linux  (needs: pkg-config, gcc, libwebkit2gtk-4.1-dev or 4.0-dev)
//	CGO_ENABLED=1 go build -tags native -o pixelsentinel-app ./native
//
//	# macOS  (needs: Xcode command-line tools)
//	CGO_ENABLED=1 go build -tags native -o pixelsentinel-app ./native
//
//	# Windows (needs: gcc via mingw-w64; WebView2 runtime is preinstalled on Win11)
//	go build -tags native -ldflags="-H windowsgui" -o pixelsentinel-app.exe ./native
//
// At runtime the native shell looks for the `pixelsentinel` binary in
// the same directory as itself, then on $PATH, and finally as
// `./pixelsentinel` (or `.exe`) relative to CWD.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	webview "github.com/webview/webview_go"
)

const appName = "PixelSentinel"

func main() {
	dataDir := flag.String("data", "", "library data directory (passed through to pixelsentinel)")
	serverPath := flag.String("server", "", "path to the pixelsentinel binary (default: auto-detect)")
	flag.Parse()

	bin, err := resolveServerBinary(*serverPath)
	if err != nil {
		log.Fatalf("%s: %v", appName, err)
	}

	args := []string{"--addr", "127.0.0.1:0"}
	if *dataDir != "" {
		args = append(args, "--data", *dataDir)
	}
	cmd := exec.Command(bin, args...)
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatalf("%s: pipe pixelsentinel stdout: %v", appName, err)
	}
	if err := cmd.Start(); err != nil {
		log.Fatalf("%s: start pixelsentinel: %v", appName, err)
	}

	addr, err := readListeningAddr(stdout, 5*time.Second)
	if err != nil {
		_ = cmd.Process.Kill()
		log.Fatalf("%s: %v", appName, err)
	}

	// Drain the rest of pixelsentinel's stdout so it doesn't block on
	// a full pipe buffer; relay it to ours so logs still show up.
	go io.Copy(os.Stdout, stdout)

	w := webview.New(false)
	defer w.Destroy()
	w.SetTitle(appName)
	w.SetSize(1280, 800, webview.HintNone)
	w.Navigate("http://" + addr + "/")
	w.Run()

	// Window closed — give the subprocess a moment to flush, then exit.
	if cmd.Process != nil {
		_ = cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			_ = cmd.Process.Kill()
		}
	}
}

func resolveServerBinary(explicit string) (string, error) {
	if explicit != "" {
		if _, err := os.Stat(explicit); err == nil {
			return explicit, nil
		}
		return "", fmt.Errorf("--server %q does not exist", explicit)
	}

	// 1. Same directory as this binary.
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		for _, name := range serverFilenames() {
			candidate := filepath.Join(dir, name)
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
		}
	}

	// 2. $PATH.
	for _, name := range serverFilenames() {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}

	// 3. CWD.
	for _, name := range serverFilenames() {
		if _, err := os.Stat(name); err == nil {
			abs, _ := filepath.Abs(name)
			return abs, nil
		}
	}
	return "", fmt.Errorf(
		"could not find the pixelsentinel binary. Build it first " +
			"(go build -o pixelsentinel .) and place it next to pixelsentinel-app, " +
			"on your PATH, or in the current directory")
}

func serverFilenames() []string {
	if runtime.GOOS == "windows" {
		return []string{"pixelsentinel.exe"}
	}
	return []string{"pixelsentinel"}
}

var listeningRE = regexp.MustCompile(`listening on http://([^\s]+)`)

func readListeningAddr(r io.Reader, timeout time.Duration) (string, error) {
	type res struct {
		addr string
		err  error
	}
	out := make(chan res, 1)
	go func() {
		sc := bufio.NewScanner(r)
		for sc.Scan() {
			line := sc.Text()
			os.Stdout.WriteString(line + "\n")
			if m := listeningRE.FindStringSubmatch(line); m != nil {
				addr := strings.TrimSpace(m[1])
				out <- res{addr: addr}
				return
			}
		}
		err := sc.Err()
		if err == nil {
			err = fmt.Errorf("pixelsentinel exited before printing its listening address")
		}
		out <- res{err: err}
	}()
	select {
	case r := <-out:
		return r.addr, r.err
	case <-time.After(timeout):
		return "", fmt.Errorf("timed out waiting for pixelsentinel to print its listening address")
	}
}
