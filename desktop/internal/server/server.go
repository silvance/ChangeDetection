// Package server is the PixelSentinel HTTP server, factored out of the
// CLI binary so that wrappers (the `native` build, future Wails shell,
// integration tests, etc.) can run the exact same routes in-process
// without forking a subprocess or duplicating route wiring.
package server

import (
	"context"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/silvance/pixelsentinel/internal/api"
	v1 "github.com/silvance/pixelsentinel/internal/api/v1"
	"github.com/silvance/pixelsentinel/internal/library"
)

// Config tells Run how to start the server.
type Config struct {
	// Addr is a TCP listen address (":7421", "127.0.0.1:0", etc.).
	Addr string
	// DataDir is the on-disk library root.
	DataDir string
	// AppName / AppVersion are reported via /api/v1/info.
	AppName    string
	AppVersion string
	// FrontendFS is the embedded React build, expected to contain a
	// "frontend/dist" subtree. Pass `embed.FS{}` to skip serving the UI.
	FrontendFS fs.FS
	// FrontendSubdir is the path inside FrontendFS to mount as the static
	// site. Defaults to "frontend/dist" if empty.
	FrontendSubdir string
}

// Server is a started PixelSentinel instance.
type Server struct {
	httpSrv *http.Server
	lib     *library.Library
	addr    string
}

// Addr returns the actual listening address (useful when Cfg.Addr was ":0").
func (s *Server) Addr() string { return s.addr }

// PairingToken returns the static pairing token a phone client must
// present to call /api/v1/* from off-host.
func (s *Server) PairingToken() string { return s.lib.PairingToken() }

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

// Start configures the routes, opens the library, and binds the listener.
// It does *not* call Serve — the caller can decide whether to block on
// Run() (for the CLI binary) or kick it off in a goroutine (for native
// shells that need to know the bound address before opening a window).
func Start(cfg Config) (*Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir %q: %w", cfg.DataDir, err)
	}
	lib, err := library.Open(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("open library at %q: %w", cfg.DataDir, err)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:3000"},
		AllowMethods: []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Content-Type", "Authorization", "X-PixelSentinel-Token"},
	}))

	// Legacy single-shot API kept for the bundled UI.
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

	v1g := r.Group("/api/v1")
	v1.Register(v1g, lib, v1.ServerInfo{
		Name:    cfg.AppName,
		Version: cfg.AppVersion,
		DataDir: cfg.DataDir,
	})

	if cfg.FrontendFS != nil {
		sub := cfg.FrontendSubdir
		if sub == "" {
			sub = "frontend/dist"
		}
		subFS, err := fs.Sub(cfg.FrontendFS, sub)
		if err != nil {
			return nil, fmt.Errorf("mount embedded frontend: %w", err)
		}
		fileServer := http.FileServer(http.FS(subFS))
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			if len(path) > 1 {
				if f, err := subFS.Open(path[1:]); err == nil {
					f.Close()
					fileServer.ServeHTTP(c.Writer, c.Request)
					return
				}
			}
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return nil, fmt.Errorf("listen on %q: %w", cfg.Addr, err)
	}

	srv := &http.Server{Handler: r}

	s := &Server{httpSrv: srv, lib: lib, addr: ln.Addr().String()}

	go func() {
		_ = srv.Serve(ln)
	}()
	return s, nil
}

// Run is a convenience wrapper for the CLI: Start, then block on a
// signal-driven shutdown.
func Run(cfg Config) error {
	s, err := Start(cfg)
	if err != nil {
		return err
	}

	fmt.Printf("%s %s\n", cfg.AppName, cfg.AppVersion)
	fmt.Printf("library: %s\n", cfg.DataDir)
	fmt.Printf("listening on http://%s\n", s.Addr())
	fmt.Printf("pairing token: %s\n", s.PairingToken())

	// Block forever — the gin server runs in a goroutine inside Start.
	// The CLI exits via OS signal; for tests, callers use Shutdown.
	select {}
}

// DefaultDataDir returns a sensible per-user library directory.
func DefaultDataDir() string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "pixelsentinel")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".pixelsentinel")
	}
	return "./pixelsentinel-data"
}

// WaitForReady polls the server until it answers on /api/v1/info or the
// context expires. Used by native shells that need to wait for the
// server before opening a webview pointing at it.
func WaitForReady(ctx context.Context, addr string) error {
	url := "http://" + addr + "/api/v1/info"
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
}
