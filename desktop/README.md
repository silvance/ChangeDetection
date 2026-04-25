# PixelSentinel desktop server

Single self-contained Go binary that serves the PixelSentinel evidence
library at `http://localhost:7421`. Forked from
[skinnyrad/TSCM-Change-Detection](https://github.com/skinnyrad/TSCM-Change-Detection)
(MIT, © 2024 Skinny R&D); the upstream's pure-Go image-processing core
is preserved unchanged under `internal/imgproc/`.

For build instructions, the API surface, the Evidence Pack format and the
overall project layout, see the [top-level README](../README.md).

## Quick run

```sh
cd frontend && bun install && bun run build && cd ..
go build -o pixelsentinel .
./pixelsentinel
```

The server prints its data directory and pairing token on startup. Phones
must present the token in the `X-PixelSentinel-Token` header to import
Evidence Packs.

## Layout

```
main.go                          server entry point + route wiring
internal/api/                    legacy /api/* handlers (single-shot UI)
internal/api/v1/                 PixelSentinel /api/v1/* handlers (cases, scans, import)
internal/library/                on-disk case + scan store
internal/evidencepack/           Evidence Pack v1 format reader
internal/imgproc/                pure-Go change detection (from upstream, unchanged)
internal/state/                  in-memory single-shot state (legacy UI)
frontend/                        React 19 + TS frontend
```
