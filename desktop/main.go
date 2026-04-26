// Package main is the PixelSentinel desktop server.
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
// History note: PixelSentinel was forked from skinnyrad/TSCM-Change-Detection
// (MIT, © 2024 Skinny R&D). Everything under /api/v1 and the on-disk library
// is original to this fork.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/silvance/pixelsentinel/internal/api"
	v1 "github.com/silvance/pixelsentinel/internal/api/v1"
	"github.com/silvance/pixelsentinel/internal/library"
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
	dataDir := flag.String("data", envOr("PIXELSENTINEL_DATA", defaultDataDir()), "library data directory")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatalf("%s: cannot create data dir %q: %v", appName, *dataDir, err)
	}

	lib, err := library.Open(*dataDir)
	if err != nil {
		log.Fatalf("%s: cannot open library at %q: %v", appName, *dataDir, err)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	// CORS: allow the Bun dev server (localhost:3000) during development.
	// The phone client posts directly to /api/v1/import/pack and authenticates
	// with a paired token instead, so it doesn't need CORS.
	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:3000"},
		AllowMethods: []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Content-Type", "Authorization", "X-PixelSentinel-Token"},
	}))

	// ── Legacy single-shot API (kept for the bundled React UI) ──────────────
	apiGroup := r.Group("/api")
	apiGroup.POST("/upload/before", api.HandleUploadBefore)
	apiGroup.POST("/upload/after", api.HandleUploadAfter)
	apiGroup.POST("/analyze", api.HandleAnalyze)
	apiGroup.POST("/analyze/diff", api.HandleAnalyzeDiff)
	apiGroup.POST("/analyze/subtraction", api.HandleAnalyzeSubtraction)
	apiGroup.POST("/analyze/heatmap", api.HandleAnalyzeHeatmap)
	apiGroup.POST("/analyze/canny", api.HandleAnalyzeCanny)
	apiGroup.POST("/warp", api.HandleWarp)
	apiGroup.POST("/clear-warp", api.HandleClearWarp)
	apiGroup.GET("/image/before", api.HandleImageBefore)
	apiGroup.GET("/image/after", api.HandleImageAfter)

	// ── PixelSentinel v1 API ────────────────────────────────────────────────
	// Cases / scans / Evidence Pack import.
	v1g := r.Group("/api/v1")
	v1.Register(v1g, lib, v1.ServerInfo{
		Name:    appName,
		Version: appVersion,
		DataDir: *dataDir,
	})

	// Serve embedded React frontend for all other routes (SPA fallback)
	subFS, err := fs.Sub(frontendDist, "frontend/dist")
	if err != nil {
		log.Fatalf("%s: cannot mount embedded frontend: %v", appName, err)
	}
	fileServer := http.FileServer(http.FS(subFS))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		f, err := subFS.Open(path[1:]) // strip leading /
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})

	fmt.Printf("%s %s\n", appName, appVersion)
	fmt.Printf("library: %s\n", *dataDir)
	fmt.Printf("listening on http://localhost%s\n", *addr)
	fmt.Printf("pairing token: %s\n", lib.PairingToken())
	if err := r.Run(*addr); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func defaultDataDir() string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "pixelsentinel")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".pixelsentinel")
	}
	return "./pixelsentinel-data"
}
