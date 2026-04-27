// Package main is the headless PixelSentinel desktop server.
//
// PixelSentinel is a TSCM change-detection desktop tool. It serves a single
// self-contained Go binary that:
//
//   - exposes the legacy single-shot analysis API at /api/* for the bundled
//     React UI (Before / After upload, analyze, warp, etc.);
//   - exposes a versioned PixelSentinel API at /api/v1/* covering case-based
//     evidence libraries, scan persistence, and Evidence Pack import from
//     the Android client.
//
// For a native-window build that wraps this same server in an OS WebView,
// see ./native/native.go (build with `-tags native`).
//
// History note: PixelSentinel was forked from skinnyrad/TSCM-Change-Detection
// (MIT, © 2024 Skinny R&D). Everything under /api/v1 and the on-disk library
// is original to this fork.
package main

import (
	"embed"
	"flag"
	"log"
	"os"

	"github.com/silvance/pixelsentinel/internal/server"
)

//go:embed all:frontend/dist
var frontendDist embed.FS

const (
	appName    = "PixelSentinel"
	appVersion = "0.1.0-dev"
	// 7421 keeps us off the upstream's 8080 so both can coexist on a dev box.
	defaultAddr = ":7421"
)

func main() {
	addr := flag.String("addr", envOr("PIXELSENTINEL_ADDR", defaultAddr), "listen address")
	dataDir := flag.String("data", envOr("PIXELSENTINEL_DATA", server.DefaultDataDir()), "library data directory")
	flag.Parse()

	if err := server.Run(server.Config{
		Addr:       *addr,
		DataDir:    *dataDir,
		AppName:    appName,
		AppVersion: appVersion,
		FrontendFS: frontendDist,
	}); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
