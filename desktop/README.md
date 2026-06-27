# DALI OS — macOS Desktop Shell (Tauri v2)

A thin native shell that wraps the live hosted DALI OS web app
(`https://os.dali.dartmouth.edu`) in a macOS WKWebView. It adds what the web app
can't do alone: device-pairing sign-in (Google blocks embedded webviews),
background native notifications, a real tray/dock presence, deep-link
click-through, and auto-update. The server stays unchanged except for the
additive `/auth/pair/*` + `/auth/handoff` + `/link` routes in `../dali-api`.

See `../TAURI_DESKTOP_PLAN.md` for the full design.

## Security model (read first)

The main window loads a **remote origin we don't fully trust at the IPC
boundary**. In Tauri v2 a window only gets IPC access if a capability lists its
origin under `remote.urls` — and we never do that for the prod origin. So XSS in
the web app reaches **zero** native commands. All native escalation happens
either in Rust directly (the poller raises notifications / sets the badge) or
only from the **local, bundled** pairing/offline windows. See
`src-tauri/capabilities/`.

## Prerequisites

- Rust (stable) + Xcode Command Line Tools (`xcode-select --install`).
- Node 22 (`npm install` here installs the Tauri CLI).
- App icons: drop a 1024×1024 PNG and run `npm run icon ./icon-source.png` to
  generate `src-tauri/icons/*` (the `.icns` + PNGs the bundle references). A
  templated menubar icon (`tray-Template.png` / `@2x`) is a design deliverable.

## Develop

```bash
npm install
npm run tauri:dev      # loads the prod origin; first run launches device pairing
```

## Release (requires secrets — see CI)

Releases are cut by CI (`../.github/workflows/desktop-release.yml`) on a
`desktop-v*` tag. Two **separate** signing layers (don't conflate):

1. **Apple Developer ID** + hardened runtime + `notarytool` + staple — so
   Gatekeeper trusts the `.dmg`.
2. **Tauri updater minisign keypair** — generate once with
   `npm run tauri signer generate`; put the **public** key in
   `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) and the **private** key
   in the CI secret `TAURI_SIGNING_PRIVATE_KEY`.

Artifacts (`.dmg`, `*.app.tar.gz(.sig)`, `latest.json`) publish to the dedicated
public bucket `s3://dali-os-desktop-releases` (see `aws/README.md`).

### Things you must provision (the shell can't)

- Apple Developer Program account → Developer ID Application cert (.p12),
  app-specific password, Team ID.
- The updater minisign keypair (public key into config, private into CI).
- The `dali-os-desktop-releases` bucket + a scoped CI IAM user (see `aws/`).
- App icon assets.
