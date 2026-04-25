# PixelSentinel

A two-part TSCM (Technical Surveillance Counter‑Measures) change‑detection
toolset — a phone client that captures Before/After photographs in the
field, and a paired desktop server that ingests phone evidence and
maintains a persistent case‑based library on a larger screen.

## Repository layout

```
.
├── app/        Android phone client (Kotlin, AndroidX, CameraX, Room).
│               Captures or imports Before/After pairs, runs change
│               detection locally, persists scans to history, and exports
│               saved scans as PixelSentinel Evidence Packs (zip).
│
└── desktop/    Go (Gin) backend + React/TypeScript frontend served as a
                single self-contained binary at http://localhost:7421.
                Maintains a multi-case evidence library on disk and accepts
                Evidence Pack imports from the phone over LAN.
```

## Building

### Phone (`app/`)
JDK 17 required.
```sh
./gradlew assembleDebug
```
Output APK: `app/build/outputs/apk/debug/app-debug.apk`.

### Desktop (`desktop/`)
Go 1.24+ and Bun required.
```sh
cd desktop
cd frontend && bun install && bun run build && cd ..
go build -o pixelsentinel .
./pixelsentinel
```
The server prints the data directory and a generated **pairing token** on
startup — phones must present this token in the
`X-PixelSentinel-Token` header to import scans. The token is stored at
`<data>/config.json` so it persists across restarts.

Useful flags:

```
--addr :7421            listen address (default :7421)
--data ~/.pixelsentinel data directory (default $XDG_DATA_HOME/pixelsentinel)
```

## Phone → desktop: Evidence Packs

The phone exports any saved scan as an **Evidence Pack v1** — a single zip
containing:

```
manifest.json    metadata + analysis params + alignment points
before.jpg
after.jpg
result.png       optional, only when the scan has been analysed
```

You can ship the pack to the desktop by any channel; the simplest is the
phone's share sheet. The desktop accepts it at:

```
POST /api/v1/import/pack
  Content-Type: application/zip   (or multipart/form-data with field "pack")
  X-PixelSentinel-Token: <pairing token>
  ?caseId=<existing case id>      (optional; auto-creates a case if absent)
```

### v1 API surface (cases / scans)

```
GET    /api/v1/info                                 — public, server identity
GET    /api/v1/cases                                 — list cases
POST   /api/v1/cases                                 — create case
GET    /api/v1/cases/:id                             — get case
DELETE /api/v1/cases/:id                             — delete case + scans
GET    /api/v1/cases/:id/scans                       — list scans in a case
GET    /api/v1/cases/:id/scans/:sid                  — get scan metadata
GET    /api/v1/cases/:id/scans/:sid/files/:filename  — fetch an image
DELETE /api/v1/cases/:id/scans/:sid                  — delete scan
POST   /api/v1/import/pack                           — ingest Evidence Pack
```

All endpoints except `/info` require the pairing token.

The legacy single‑shot endpoints (`/api/upload/before`, `/api/analyze`,
`/api/warp`, etc.) are still served for the bundled React UI — they will
move into the new case‑based UI in a follow‑up.

## Roadmap

- React UI overhaul: case list, scan library, scan detail viewer.
- Native shell via Wails (single executable per OS, no localhost browser).
- Auto‑alignment via ORB + RANSAC; manual point picking as fallback only.
- Chain‑of‑custody hashes + signed pack exports backed by Android Keystore.
- Time‑series scan view across repeated visits.

## Attribution

The `desktop/` tree was forked from
[skinnyrad/TSCM-Change-Detection](https://github.com/skinnyrad/TSCM-Change-Detection)
(MIT, © 2024 Skinny R&D). The full upstream license is preserved in
`desktop/LICENSE`. The pure-Go imgproc core is unchanged from upstream;
everything else — module path, port, persistent library, /api/v1 surface,
Evidence Pack format, phone client — is original to PixelSentinel.

The `app/` tree is original Kotlin code that links the same change-detection
analysis core through the bundled `tscmlib.aar`.
