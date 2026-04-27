// Package v1 wires the PixelSentinel /api/v1/* HTTP surface.
//
// Routes registered here are deliberately distinct from the legacy /api/*
// endpoints (which drive the bundled single-shot React UI). The v1 surface
// is the one phones talk to, and the one a future native shell or third-
// party desktop tool would target.
package v1

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/silvance/pixelsentinel/internal/evidencepack"
	"github.com/silvance/pixelsentinel/internal/library"
)

// ServerInfo is what GET /api/v1/info returns. Pure metadata about the
// running daemon — the phone uses this to verify it's pointed at a
// PixelSentinel instance and not some other Gin server on the same port.
type ServerInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	DataDir   string `json:"dataDir,omitempty"`   // populated for loopback callers only
	Token     string `json:"token,omitempty"`     // ditto — never leaks off-host
	Loopback  bool   `json:"loopback"`            // true when the request came from this host
}

// Register attaches all v1 routes to the given Gin group.
func Register(g *gin.RouterGroup, lib *library.Library, info ServerInfo) {
	h := &handlers{lib: lib, info: info}

	// Public — used by phones for discovery / sanity check, and by the
	// bundled UI for the Settings page.
	g.GET("/info", h.getInfo)

	// Authenticated — anything that touches the library.
	auth := g.Group("/")
	auth.Use(requirePairingToken(lib))

	auth.GET("/cases", h.listCases)
	auth.POST("/cases", h.createCase)
	auth.GET("/cases/:caseId", h.getCase)
	auth.DELETE("/cases/:caseId", h.deleteCase)

	auth.GET("/cases/:caseId/scans", h.listScans)
	auth.GET("/cases/:caseId/ledger", h.getLedger)
	auth.GET("/cases/:caseId/scans/:scanId", h.getScan)
	auth.PATCH("/cases/:caseId/scans/:scanId", h.patchScan)
	auth.GET("/cases/:caseId/scans/:scanId/files/:name", h.getScanFile)
	auth.DELETE("/cases/:caseId/scans/:scanId", h.deleteScan)

	auth.POST("/import/pack", h.importPack)
}

type handlers struct {
	lib  *library.Library
	info ServerInfo
}

// ── Auth ───────────────────────────────────────────────────────────────────

// requirePairingToken gates v1 endpoints. Two trust modes:
//
//   - Loopback (the request originated on the same machine the server
//     runs on) is trusted unconditionally. This is what lets the bundled
//     React UI talk to /api/v1 without making the operator paste a token
//     into their own browser. Anyone with shell access on the box could
//     hit the endpoints anyway, so requiring a token here would buy
//     nothing but friction.
//
//   - Anything else (a phone on the LAN, a dev machine, a future
//     companion) must present the pairing token in either
//     X-PixelSentinel-Token or Authorization: Bearer <token>.
func requirePairingToken(lib *library.Library) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isLoopback(c.ClientIP()) {
			c.Next()
			return
		}
		got := c.GetHeader("X-PixelSentinel-Token")
		if got == "" {
			if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
				got = strings.TrimPrefix(h, "Bearer ")
			}
		}
		if got == "" || !constantTimeEq(got, lib.PairingToken()) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "missing or invalid pairing token",
			})
			return
		}
		c.Next()
	}
}

func isLoopback(ip string) bool {
	if ip == "" {
		return false
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.IsLoopback()
}

// constantTimeEq is a length-then-byte comparison that is constant time wrt
// the secret on the right. We reimplement it locally rather than pulling in
// crypto/subtle just to avoid the cargo-cult import in handlers.
func constantTimeEq(got, want string) bool {
	if len(got) != len(want) {
		// Still loop the length of want so timing doesn't reveal length.
		var diff byte
		for i := 0; i < len(want); i++ {
			diff |= want[i]
		}
		_ = diff
		return false
	}
	var diff byte
	for i := 0; i < len(want); i++ {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}

// ── Handlers ───────────────────────────────────────────────────────────────

func (h *handlers) getInfo(c *gin.Context) {
	resp := h.info
	if isLoopback(c.ClientIP()) {
		resp.Loopback = true
		resp.Token = h.lib.PairingToken()
		// DataDir is set during construction by the caller via Register.
	} else {
		// Strip anything sensitive for off-host callers.
		resp.DataDir = ""
		resp.Token = ""
		resp.Loopback = false
	}
	c.JSON(http.StatusOK, resp)
}

func (h *handlers) listCases(c *gin.Context) {
	cases, err := h.lib.ListCases()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cases": cases})
}

type createCaseRequest struct {
	Name  string `json:"name"`
	Notes string `json:"notes"`
}

func (h *handlers) createCase(c *gin.Context) {
	var req createCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("invalid body: %w", err))
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		fail(c, http.StatusBadRequest, errors.New("name is required"))
		return
	}
	cs, err := h.lib.CreateCase(name, strings.TrimSpace(req.Notes))
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, cs)
}

func (h *handlers) getCase(c *gin.Context) {
	cs, err := h.lib.GetCase(c.Param("caseId"))
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, cs)
}

func (h *handlers) deleteCase(c *gin.Context) {
	if err := h.lib.DeleteCase(c.Param("caseId")); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handlers) getLedger(c *gin.Context) {
	entries, err := h.lib.Ledger(c.Param("caseId"))
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ledger": entries})
}

func (h *handlers) listScans(c *gin.Context) {
	scans, err := h.lib.ListScans(c.Param("caseId"))
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"scans": scans})
}

func (h *handlers) getScan(c *gin.Context) {
	s, err := h.lib.GetScan(c.Param("caseId"), c.Param("scanId"))
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

type patchScanRequest struct {
	// Pointers so we can distinguish "set to empty string" from "leave alone".
	Label  *string `json:"label,omitempty"`
	Target *string `json:"target,omitempty"`
}

func (h *handlers) patchScan(c *gin.Context) {
	var req patchScanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("invalid body: %w", err))
		return
	}
	s, err := h.lib.UpdateScanMeta(
		c.Param("caseId"),
		c.Param("scanId"),
		library.ScanMetaPatch{Label: req.Label, Target: req.Target},
	)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *handlers) getScanFile(c *gin.Context) {
	path, err := h.lib.ScanFilePath(c.Param("caseId"), c.Param("scanId"), c.Param("name"))
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	c.File(path)
}

func (h *handlers) deleteScan(c *gin.Context) {
	if err := h.lib.DeleteScan(c.Param("caseId"), c.Param("scanId")); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// importPack ingests an Evidence Pack from the phone client.
//
// Two transport flavours are supported:
//
//	multipart/form-data : pack=<zip bytes>, caseId=<id>
//	application/zip      : raw zip body, ?caseId=<id>
//
// If caseId is missing or empty, a case is created on the fly named after
// the manifest label (or "Imported scan" if blank).
func (h *handlers) importPack(c *gin.Context) {
	caseID := strings.TrimSpace(c.Query("caseId"))

	var packBytes []byte
	switch ct := c.GetHeader("Content-Type"); {
	case strings.HasPrefix(ct, "multipart/form-data"):
		if v := c.PostForm("caseId"); v != "" {
			caseID = strings.TrimSpace(v)
		}
		fh, err := c.FormFile("pack")
		if err != nil {
			fail(c, http.StatusBadRequest, fmt.Errorf("missing pack field: %w", err))
			return
		}
		f, err := fh.Open()
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		defer f.Close()
		packBytes, err = io.ReadAll(io.LimitReader(f, evidencepack.MaxSize+1))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
	default:
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, evidencepack.MaxSize+1))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		packBytes = body
	}

	if len(packBytes) == 0 {
		fail(c, http.StatusBadRequest, errors.New("empty body"))
		return
	}

	pack, err := evidencepack.Read(packBytes)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err)
		return
	}

	// Verify the signature/digests if present. We do NOT reject signed-but-
	// failed packs at the HTTP layer — the operator still wants to see them
	// to diagnose what happened — but we do record the verdict on the scan
	// so the UI can flag it. Plain corruption (digest mismatch on an
	// unsigned pack with digests) is the one case we reject up front.
	verify, _ := evidencepack.Verify(pack)
	if !verify.Signed && pack.Manifest.Digests != nil && verify.Reason != "" {
		fail(c, http.StatusUnprocessableEntity,
			fmt.Errorf("evidence pack failed integrity check: %s", verify.Reason))
		return
	}

	if caseID == "" {
		// Auto-create a case if the caller didn't pick one.
		name := strings.TrimSpace(pack.Manifest.Label)
		if name == "" {
			name = "Imported scan"
		}
		cs, err := h.lib.CreateCase(name, "Auto-created on phone import.")
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		caseID = cs.ID
	}

	captured, _ := time.Parse(time.RFC3339, pack.Manifest.CapturedAt)
	if captured.IsZero() {
		captured = time.Now().UTC()
	}

	signerKey := ""
	if pack.Manifest.Signer != nil {
		signerKey = pack.Manifest.Signer.PublicKey
	}

	scan, err := h.lib.AddScan(caseID, library.Scan{
		ID:         pack.Manifest.ScanID, // may be empty; library.AddScan will generate one
		Label:      strings.TrimSpace(pack.Manifest.Label),
		CapturedAt: captured.UTC(),
		Source:     fallback(pack.Manifest.Source, "unknown"),
		Stats: library.ScanStats{
			ChangedPct:    pack.Manifest.Stats.ChangedPct,
			ChangedPixels: pack.Manifest.Stats.ChangedPixels,
			Regions:       pack.Manifest.Stats.Regions,
		},
		Params: library.ScanParams{
			Strength:       pack.Manifest.Params.Strength,
			MorphSize:      pack.Manifest.Params.MorphSize,
			CloseSize:      pack.Manifest.Params.CloseSize,
			MinRegion:      pack.Manifest.Params.MinRegion,
			PreBlurSigma:   pack.Manifest.Params.PreBlurSigma,
			NormalizeLuma:  pack.Manifest.Params.NormalizeLuma,
			HighlightR:     pack.Manifest.Params.HighlightR,
			HighlightG:     pack.Manifest.Params.HighlightG,
			HighlightB:     pack.Manifest.Params.HighlightB,
			HighlightAlpha: pack.Manifest.Params.HighlightAlpha,
		},
		Signed:            verify.Signed,
		Verified:          verify.Verified,
		SignerFingerprint: verify.SignerFingerprint,
		SignerPublicKey:   signerKey,
	}, library.ScanInputFiles{
		BeforeJPG: pack.BeforeJPG,
		AfterJPG:  pack.AfterJPG,
		ResultPNG: pack.ResultPNG,
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"caseId": caseID,
		"scan":   scan,
	})
}

// ── Helpers ────────────────────────────────────────────────────────────────

func fail(c *gin.Context, status int, err error) {
	c.AbortWithStatusJSON(status, gin.H{"error": err.Error()})
}

func fallback(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
