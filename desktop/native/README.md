# PixelSentinel — native shell

A thin OS-WebView wrapper that gives you a native window for PixelSentinel
instead of opening a browser tab to `localhost:7421`. Same React UI,
same Go API, same evidence library.

```
   ┌─────────────────────────────────┐
   │  PixelSentinel (native window)  │
   │ ┌─────────────────────────────┐ │
   │ │  WebView                    │ │
   │ │   (loads http://127.0.0.1:N)│ │       ┌─────────────────────────────┐
   │ │                             │ │ <───> │ pixelsentinel (subprocess)  │
   │ └─────────────────────────────┘ │       │   /api/* + /api/v1/*        │
   └─────────────────────────────────┘       │   embedded React build      │
                                             └─────────────────────────────┘
```

The native binary (`pixelsentinel-app`) launches the headless
`pixelsentinel` binary as a subprocess on a random loopback port,
parses the printed `listening on …` line for the address, and opens an
OS-native WebView pointed at it. When the window closes, the
subprocess is signalled, given two seconds to shut down cleanly, then
killed.

## Why a subprocess and not in-process?

Two reasons:

1. The headless binary owns the embedded React `frontend/dist`. Embedding
   it a second time from `desktop/native/` would mean either duplicating
   the dist or building a shared package, both ugly. Letting the
   headless binary do what it already does and pointing a WebView at it
   is structurally simpler.
2. The same `pixelsentinel` build is reusable. You can run it
   standalone on a server (operators import packs from phones over the
   LAN), and the native shell is just one optional UX on top of it.

## Why webview, not Wails?

Wails is a fine framework, but it adds a JS bindings layer and a build
pipeline of its own. Since the existing React UI already talks to an
HTTP API, the lightest "native shell" possible is a WebView pointed at
that server. `github.com/webview/webview_go` does exactly that in ~100
lines of Go and one CGO dep. If you ever want richer integration
(system tray, native menus, native file-drop with full IPC), porting
this file to Wails is straightforward.

## Build

The `native` build tag isolates this from the default build because
`webview_go` requires CGO and the platform's WebView dev libraries.

First time only — pull the webview module into go.mod:
```sh
cd desktop
go mod tidy -tags native
```

### Linux

```sh
sudo apt install pkg-config libwebkit2gtk-4.1-dev   # or 4.0-dev on older distros
cd desktop
CGO_ENABLED=1 go build -tags native -o pixelsentinel-app ./native
go build -o pixelsentinel .                         # the headless server binary
./pixelsentinel-app
```

### macOS

```sh
xcode-select --install   # if you don't already have the toolchain
cd desktop
CGO_ENABLED=1 go build -tags native -o pixelsentinel-app ./native
go build -o pixelsentinel .
./pixelsentinel-app
```

To produce a clickable `.app` bundle:

```sh
mkdir -p PixelSentinel.app/Contents/MacOS
cp pixelsentinel PixelSentinel.app/Contents/MacOS/
CGO_ENABLED=1 go build -tags native \
    -o PixelSentinel.app/Contents/MacOS/pixelsentinel-app \
    ./native
open PixelSentinel.app
```

### Windows

Requires:

- gcc via mingw-w64 (e.g. `choco install mingw`).
- The Microsoft WebView2 runtime — preinstalled on Windows 11; on
  Windows 10 install the Evergreen Bootstrapper from Microsoft.

```sh
cd desktop
go build -tags native -ldflags="-H windowsgui" -o pixelsentinel-app.exe ./native
go build -o pixelsentinel.exe .
.\pixelsentinel-app.exe
```

The `-H windowsgui` linker flag suppresses the console window so the
binary launches as a true GUI app.

## Runtime behaviour

- **Server discovery**: the native shell looks for `pixelsentinel`
  (or `.exe` on Windows) in (1) the same directory as itself, (2)
  `$PATH`, (3) the current directory, in that order. Override with
  `--server /full/path/to/pixelsentinel`.
- **Library location**: same default as the headless build
  (`$XDG_DATA_HOME/pixelsentinel` / `~/.pixelsentinel`). Override with
  `--data /path/to/dir`; the value is forwarded to the subprocess.
- **Port**: random ephemeral port on 127.0.0.1, never published. Phones
  cannot import directly into a `pixelsentinel-app` instance — that
  workflow needs a separately running headless `pixelsentinel` on a
  predictable LAN address.
- **Pairing token**: visible in the in-app **Settings** page (the
  loopback bypass means no token is needed for local UI traffic).

## Why isn't this in `go build ./...`?

The default build must remain CGO-free for clean cross-compiles of the
headless server. The `//go:build native` tag at the top of `native.go`
excludes the file unless you explicitly opt in with `-tags native`.
