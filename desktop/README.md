# DALI OS Desktop

Native desktop app for DALI OS. A thin Tauri v2 shell that wraps the live hosted web app (`https://os.dali.dartmouth.edu`) in a WKWebView and adds several features:

- **Device-pairing sign-in** — Google blocks OAuth in embedded webviews, so sign-in happens in a local bundled page that hands off a session to the main window.
- **Native notifications** — a background Rust poller checks for new notifications and surfaces them through the OS notification center with deep-link click-through.
- **Auto-update** — checks for new releases on launch and prompts the user to install.
- **Tray + dock presence** — persistent menubar icon with quick actions.

## How it works

The main window loads the live prod URL. A Rust background process polls the DALI OS API for notifications and manages the update lifecycle. Sign-in and any other flows that need full browser trust happen in separate locally-bundled windows.

The web server has three additive routes to support the desktop: `/auth/pair/*`, `/auth/handoff`, and `/link`. Everything else is unchanged.

**IPC security:** the main WKWebView window has zero access to native Tauri commands — no capability file grants the prod origin any IPC permissions. All native escalation happens in Rust directly or from the locally-bundled pairing window.

## Current Limitations
- There is no ability to use `staging` or `dev` from the desktop app, this may be changed in the future. 
- Only MacOS is supported as of now, Windows support can be added as soon as a Windows signing certificate is aquired. 
- Linux support can be added as well

## Prerequisites

- Rust (stable) + Xcode Command Line Tools (`xcode-select --install`)
- Node 22

## Develop

```bash
npm install
npm run tauri:dev   # loads the prod origin; first run triggers device pairing
```

To regenerate app icons, drop a 1024×1024 PNG source and run:

```bash
npm run icon ./icon-source.png
```

This generates `src-tauri/icons/*` (`.icns` + PNGs). A templated menubar icon (`tray-Template.png` / `@2x`) is a separate design deliverable.

## Release

Releases are cut by pushing a `desktop-v*` tag. CI (`desktop-release.yml`) builds, signs, and publishes automatically.

Two signing layers (keep them separate):

1. **Apple Developer ID** — signs the `.dmg` so Gatekeeper trusts it. Requires a Developer ID Application cert (`.p12`), an app-specific password, and a Team ID in CI secrets.
2. **Tauri updater minisign keypair** — signs update artifacts so the app can verify them. Generate once with `npm run tauri signer generate`. Public key goes in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); private key goes in the CI secret `TAURI_SIGNING_PRIVATE_KEY`.

Artifacts (`.dmg`, `*.app.tar.gz`, `*.sig`, `latest.json`) publish to `s3://dali-os-desktop-releases`. See `aws/README.md` for bucket and IAM setup.

