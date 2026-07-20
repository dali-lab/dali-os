# DALI OS Desktop

Native desktop app for DALI OS. A thin Tauri v2 shell that wraps the live hosted web app (`https://os.dali.dartmouth.edu`) in a native webview and adds several features:

- **Device-pairing sign-in** — Google blocks OAuth in embedded webviews, so sign-in happens in a local bundled page that hands off a session to the main window.
- **Native notifications** — a background Rust task holds the server's SSE stream (falling back to 45s polling) and surfaces new items through the OS notification center on all three platforms, with click-through to the notification's link. Meeting invites carry **Accept / Maybe / Decline** buttons that RSVP straight from the banner; other notifications get **Mark read**. Per-event opt-out via Settings → Notifications → Desktop; time-sensitive events (registry `timeSensitive`) add sound and pin to the top of the tray menu.
  - macOS uses UNUserNotificationCenter in bundled builds: clicks survive app relaunch, and banners clear from Notification Center once their row is read elsewhere. First launch prompts for notification permission; denying it silences banners until re-enabled in System Settings. `tauri dev` (unbundled) falls back to a click-only path.
  - Linux uses XDG/D-Bus actions (button support depends on the notification daemon; GNOME/KDE work).
  - Windows uses WinRT toasts; clicks and buttons are handled while the app runs (it's tray-resident, so effectively always).
- **Auto-update** — checks for new releases on launch and prompts the user to install.
- **Tray + dock presence** — persistent menubar/tray icon showing the unread count (macOS) and the latest unread notifications with click-through, plus quick actions.

## Platform support

| Platform | Status | Notes |
|---|---|---|
| macOS 12+ | ✓ Signed + notarized | Universal binary (Apple Silicon & Intel) |
| Linux x86_64 | ✓ AppImage | Tray requires AppIndicator support (KDE, XFCE; GNOME needs an extension). Credentials stored via Secret Service (GNOME Keyring / KWallet). |
| Windows 10+ x64 | ✓ NSIS installer | Unsigned — SmartScreen will warn on first run; click **More info → Run anyway**. Add `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` secrets to enable signing. Requires WebView2 (pre-installed on most systems). |

## How it works

The main window loads the live prod URL. A Rust background task holds `/api/notifications/stream` (SSE) for live notification delivery — degrading to a 45s poll of `/api/notifications` whenever the stream can't be held — and manages the update lifecycle. Sign-in and any other flows that need full browser trust happen in separate locally-bundled windows.

The web server has three additive routes to support the desktop (`/auth/pair/*`, `/auth/handoff`, `/link`) plus the notification feed/stream APIs above. Everything else is unchanged.

**IPC security:** the main window has zero access to native Tauri commands — no capability file grants the prod origin any IPC permissions. All native escalation happens in Rust directly or from the locally-bundled pairing window.

## Current limitations

- No ability to target `staging` or `dev` from the desktop app — always loads prod.

## Prerequisites

- Rust (stable)
- Node 22
- **macOS only:** Xcode Command Line Tools (`xcode-select --install`)
- **Linux only:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

## Develop

```bash
npm install
npm run tauri:dev   # loads the prod origin; first run triggers device pairing
```

To regenerate app icons, drop a 1024×1024 PNG source and run:

```bash
npm run icon ./icon-source.png
```

This generates `src-tauri/icons/*`. A templated menubar icon (`tray-Template.png` / `@2x`) is a separate design deliverable.

## Release

Releases are cut automatically when the `version` field in `src-tauri/tauri.conf.json` changes on `prod` (i.e. when the version bump is promoted). CI (`desktop-release.yml`) builds all three platforms in parallel, then publishes a merged `latest.json` and tags the release.

You can also trigger a release manually via `workflow_dispatch` or a `desktop-v*` tag push.

### Signing layers

**macOS** — two layers:
1. **Apple Developer ID** — signs and notarizes the `.dmg` so Gatekeeper trusts it. Requires `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` in CI secrets. The build falls back to unsigned if these are absent.
2. **Tauri updater minisign keypair** — signs update artifacts for in-app verification. Generate once with `npm run tauri signer generate`. Public key goes in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); private key goes in the CI secret `TAURI_SIGNING_PRIVATE_KEY`.

**Linux** — only the Tauri updater minisign signature (same keypair as macOS). No OS-level signing.

**Windows** — only the Tauri updater minisign signature by default (unsigned installer). To add Authenticode code signing and suppress the SmartScreen prompt, add `WINDOWS_CERTIFICATE` (base64-encoded PFX) and `WINDOWS_CERTIFICATE_PASSWORD` secrets — the Tauri action picks them up automatically with no workflow changes.

### Artifacts

All artifacts publish to `s3://dali-os-desktop-releases`:

| File | Description |
|---|---|
| `releases/<version>/` | Versioned artifacts for all platforms |
| `DALI-OS-macos.dmg` | Stable macOS installer (no version in name) |
| `DALI-OS-linux.AppImage` | Stable Linux AppImage (no version in name) |
| `DALI-OS-windows.exe` | Stable Windows installer (no version in name) |
| `latest.json` | Updater feed consumed by all installed clients |

The `/download` page on the web app links to the stable files, so it never needs updating after a release. See `aws/README.md` for bucket and IAM setup.
