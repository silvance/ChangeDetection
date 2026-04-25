# TSCM Change Detection

A two-part toolset for image-based change detection in Technical Surveillance
Counter‑Measures (TSCM) work — a phone client that captures Before/After
photographs and a desktop server that the phone can sync evidence into for
deeper analysis on a larger screen.

## Repository layout

```
.
├── app/        Android phone client (Kotlin, AndroidX, CameraX, Room).
│               Captures or imports Before/After pairs, runs the bundled Go
│               analysis library locally, persists scans to history.
│
└── desktop/    Go (Gin) backend + React/TypeScript frontend, served as a
                single self-contained binary at http://localhost:8080.
                Vendored from skinnyrad/TSCM-Change-Detection (MIT). The
                phone app and the desktop tool share the same Go analysis
                core, so results are reproducible across devices.
```

## Building

### Phone (`app/`)
Open in Android Studio Iguana or newer, or:
```sh
./gradlew assembleDebug
```
Requires JDK 17. Output APK at `app/build/outputs/apk/debug/`.

### Desktop (`desktop/`)
Requires Go 1.25+ and Bun.
```sh
cd desktop
cd frontend && bun install && bun run build && cd ..
go build -o tscm-change-detection .
./tscm-change-detection
```
The server listens on `http://localhost:8080`.

## Attribution

The `desktop/` tree is a fork of
[skinnyrad/TSCM-Change-Detection](https://github.com/skinnyrad/TSCM-Change-Detection)
(© 2024 Skinny R&D, MIT). The full upstream license is preserved in
`desktop/LICENSE`. Modifications made in this repository are likewise MIT
unless noted otherwise.

The `app/` tree is original Kotlin code that links the same `tscmlib.aar`
analysis library used by the upstream desktop tool.
