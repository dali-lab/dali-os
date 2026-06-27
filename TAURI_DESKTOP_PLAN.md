# Tauri Desktop App — Plan

Native desktop app for DALI OS using **Tauri v2**, wrapping the live hosted React
Router 7 app in a native webview. This is the "most native of Path A" approach:
a native shell around the existing web app, **no backend rewrite**.

DALI OS epic: `cmqvki5il000viiotxd1elg87` (project: DALI OS).

## Decided scope (final)

- **Platforms:** **macOS only for v1.** Windows is a fast-follow (the shell,
  poller, pairing, and updater are all cross-platform; Windows adds signing +
  packaging + WebView2 cookie verification, not a rewrite). No Linux.
- **Prod target:** the webview loads `https://os.dali.dartmouth.edu`
  (Fly app `dali-api-prod`). CSP `connect-src` allowlist: `'self'`,
  `wss://os.dali.dartmouth.edu:3002` (collab), the S3 bucket origin, Google.
- **Environments:** prod only — a single build hardcoded to the prod origin. QA
  the web content in a browser; QA the native shell against prod.
- **Distribution:** direct download of a **notarized `.dmg`**, **not** the Mac
  App Store (its sandbox conflicts with the keychain token + deep-link scheme).
- **macOS signing (no decision — the one required path):** Apple Developer
  Program, Developer ID Application cert, hardened runtime, notarize via
  `notarytool` + staple. Gatekeeper effectively blocks unsigned apps, so this is
  mandatory.
- **Auth model:** device pairing (GitHub-CLI style) — the system browser does a
  normal login; OAuth code and `login.tsx` stay **untouched**. Adds one additive
  `DevicePairing` table; credentials are opaque `Session` rows (no JWT). See Auth.
- **Notifications:** background — a Rust-side poller raises native notifications
  even when the window is minimized/in the tray (see Notifications below).
- **Close button:** **minimize to tray** (keeps the background poller alive);
  Quit is explicit via tray/menu.
- **Device revocation:** v1 ships a minimal **"your devices"** settings page
  (label + last-seen + Revoke) that kills a paired device's keychain Session.
- **Update feed:** `latest.json` + binaries hosted in **S3** (already in stack).

## Decision & rationale (Path A vs B)

DALI OS is a canonical React Router 7 full-stack app (`ssr: true`): ~188 route
modules with `loader`/`action` exports, loaders importing `prisma` and hitting
Postgres directly, httpOnly-cookie session auth, Hocuspocus collab, S3, Slack,
Google/CAS OAuth. Tauri wraps a *frontend* webview — no Node runtime, Prisma, or
Postgres.

- **Path A — thin native shell around the hosted app (chosen).** Webview loads
  the prod origin; the Fly.io SSR server keeps running unchanged.
- **Path B — true native/offline app (rejected).** SPA (`ssr: false`) + rewrite
  all ~188 DB-coupled loaders behind a standalone API. Months of work; loses
  SSR; poor fit given realtime collab + OAuth + Postgres-centric design.

## What stays untouched

Everything server-side. SSR (`ssr: true`), all loaders/actions, direct Prisma
access, Hocuspocus, S3, Slack — the Fly.io deployment runs exactly as today.
Tauri's main window is a `WebviewWindow` pointed at the prod origin. The desktop
app is a **window onto the live frontend**, not a copy of it. New web features
appear in the app for free on deploy.

## Auth — device pairing (GitHub-CLI style)

Chosen over piggybacking the existing OAuth flow (see decision log at bottom).
Rationale: it leaves **all OAuth code and `login.tsx` completely untouched**,
works identically for Google and CAS, is naturally one-time/redeem-only, and
keeps the web app desktop-agnostic. Cost: one extra "approve this device" click,
a short poll loop, and one additive `DevicePairing` table.

### Two hard constraints it satisfies

1. **Google blocks embedded webviews** (`disallowed_useragent`), and primary
   login is Google (`@dali.dartmouth.edu`) — so login must run in the **real
   system browser**, never the Tauri webview. Pairing logs in via a normal
   browser, so this holds for free. (Spoofing the UA violates Google policy and
   is fragile — not viable.)
2. **System browser and webview have separate cookie jars** — so a final
   "planting" step is always required to get `__dali_sid` into the webview's jar.
   Handled by `/auth/handoff` below. No design avoids this step.

Relevant code fact: `app/lib/cookies.ts` `parseSessionId` already accepts an
`Authorization: Bearer <rawSessionId>` (built for MCP clients), so opaque session
ids are portable credentials we can reuse for the keychain token.

### Flow

1. App calls `POST /auth/pair/start` (unauthenticated). Server creates a
   `DevicePairing` row — random `deviceCode` (hashed in DB, raw returned to the
   app for polling), a short human `userCode`, `status=pending`, ~10 min expiry,
   and a device label (hostname/OS). Returns `{ deviceCode, userCode,
   verificationUrl }`.
2. App opens the **system browser** to `verificationUrl` (`/link?code=<userCode>`).
   If not already signed in, the user logs in **normally** — Google/CAS, real
   browser, no embedded-webview block, **no changes to `login.tsx` or the
   callbacks**. The `/link` page shows the `userCode` + device label and an
   **Approve** button.
3. On **Approve** (POST in the user's authenticated web session), the server
   binds `DevicePairing.userId` and marks the row approved.
4. App **polls** `POST /auth/pair/poll` with the raw `deviceCode` (interval ~3s,
   honoring `pending` / `slow_down` / `expired`). Once approved, the server:
   - mints a long-lived **desktop Session** (Bearer credential for the Rust
     notification poller), returned for the **OS keychain**, and
   - mints a **one-time handoff code** (stored hashed on the pairing row,
     single-use, ~60s), returned to the app.
5. **Plant (`/auth/handoff`).** App navigates the **webview** to
   `/auth/handoff?code=<handoffCode>`. The route redeems the one-time code,
   `Set-Cookie`s a fresh 30-day session into the **webview's** cookie jar, and
   redirects to `/`. The 30-day session id is **born inside the webview jar** —
   it never travels in a URL. Authenticated.

Two credentials result, both opaque `Session` rows (Bearer-capable,
independently revocable): the **webview cookie session** (the app UI) and the
**keychain desktop session** (the background poller). No JWT.

### Server surface (all additive)

`POST /auth/pair/start`, `POST /auth/pair/poll`, a `/link` approval page +
`POST /auth/pair/approve`, and `/auth/handoff` (redeem one-time code → set
cookie). One additive `DevicePairing` table (migration-check permits additive
migrations). **No edits to `login.tsx`, the OAuth callbacks, or any loader** —
so the web app stays fully desktop-agnostic; the only new web surface is the
`/link` page.

### Hardening

- The Approve page shows the `userCode` + device label so the user confirms
  *which* device they're approving (mitigates a remote-initiated pairing tricking
  a signed-in user into approving). Short expiry; rate-limit `start`/`poll`/
  `approve`.
- `deviceCode` and `handoffCode` stored hashed; handoff code single-use.
- The keychain desktop token is device-scoped and revocable (future "your
  devices" UI). A stolen laptop = a live Bearer token until revoked.

### Session lifecycle & re-auth (must-build, easy to overlook)

- **First run:** the webview loads the prod origin, `requireAuth` redirects to
  `/login`; the shell detects the unauthenticated state and launches **pairing**
  instead of showing the web login page.
- **Session expiry / revocation while installed:** the webview cookie is 30-day
  rolling. When it lapses (or is revoked from "your devices"), loaders
  `redirect('/login')`. The web login page **cannot** complete a login inside the
  webview (login happens via pairing), so the **shell must intercept navigations
  to `/login` and re-trigger pairing** rather than render it. Without this, an
  expired session strands the user on an unusable login page. This is the one
  place the shell watches webview navigation for auth.
- **Desktop poller token:** also a rolling `Session`. The Rust poller must treat
  a 401 as "expired" and surface a re-pair prompt; give desktop tokens a longer
  absolute TTL so background notifications don't silently lapse mid-month.
- **Logout:** a Sign-out action revokes **both** sessions (webview + keychain),
  clears the keychain entry, and returns the app to the pairing screen.

### `/link` approve-page copy

The page the user lands on (in the system browser) to approve a paired device.
Anti-phishing anchors: show the `userCode` + device label prominently (must match
what the app shows), tie the action to "only if you just opened the app
yourself," and always show *which account* is approving. Keep `userCode` short
and unambiguous (e.g. 8 chars, no `0/O`/`1/I/L`) since users eyeball-compare it.

**Not signed in** — banner above the normal login:
> **Sign in to approve a device** — You're linking the DALI OS desktop app. Sign
> in to continue, then you'll confirm the device. *(After login, return to
> `/link?code=…`.)*

**Signed in, valid pending code (main screen):**
> # Approve this device?
> **DALI OS Desktop** wants to sign in to your account.
> **Device:** MacBook Pro · macOS  **Pairing code:** **`WXYZ-1234`**
> ⚠️ Confirm this code **matches the one shown in the app**. Only approve if *you*
> just opened DALI OS Desktop on this computer. Approving keeps the app signed in
> to your account until you sign out or revoke it.
> Approving as **\<email>** — _not you? [Switch account]_
> **[ Approve device ]**  [ Cancel ]

**Approved (success):**
> # ✅ Device approved
> Head back to **DALI OS Desktop** — it'll finish signing in automatically. You
> can close this tab. _Manage devices under **Settings → Your devices**._

**Code expired / not found:**
> # This pairing request expired
> For your security, pairing codes expire after a few minutes. Open **DALI OS
> Desktop** and choose **Sign in** again to get a fresh code.

**Code already used:**
> # This request was already used
> This pairing code has already approved a device. If that wasn't you, go to
> **Settings → Your devices** and revoke any device you don't recognize.

**Cancelled / denied:**
> # Pairing cancelled
> No device was linked to your account. You can close this tab.

**Visited `/link` with no code (manual entry fallback):**
> # Link a desktop device
> Enter the code shown in **DALI OS Desktop**: `[ ____ - ____ ]` **[ Continue ]**
> _Don't have the app open? Launch DALI OS Desktop and choose **Sign in** first._

## Security & platform constraints

- **Remote content escalates web XSS to native APIs.** Because the main window
  loads our remote origin, any XSS in the web app can reach whatever Tauri IPC we
  expose. Lock Tauri v2 **capabilities** so the remote origin gets **nothing** by
  default — no `fs`, `shell`, or `http` plugin access — and expose only a tiny
  custom command surface (`raise_notification`, `set_badge`, `open_external`).
  Treat this as a first-class constraint, not an afterthought.
- **Cookie persistence across restarts must be verified.** The "stay logged in"
  UX depends on the webview persisting `__dali_sid` to disk via the macOS
  WKWebView persistent data store. If unconfigured, users are logged out on every
  launch. Explicit verification task. (Windows WebView2 user-data-folder is the
  equivalent for the fast-follow.)
- **Keychain credential.** The long-lived desktop Session for the Rust poller
  lives in the macOS Keychain, device-scoped and revocable via the "your devices"
  page.

## "Most native" surface (ranked by value)

| Native feature | How | Effort |
|---|---|---|
| Real window, native menu bar, dock/tray icon | Tauri config + menu definition | low |
| Background native notifications | Rust-side poller (keychain Bearer token) over the existing `api.notifications.ts` endpoint → `tauri-plugin-notification` | med |
| Dock/taskbar badge count (unread) | `set_badge_count` from the poller | low |
| Auto-update | `tauri-plugin-updater` + signed `latest.json` on S3 | med |
| Notification click-through | `dalios://` deep link → single-instance routes URL into the running window → focus + navigate | low–med |
| External-link handling | origin-based nav interception: same-origin in webview, cross-origin → system browser | low–med |
| Device-pairing sign-in + cookie-plant | `/auth/pair/*` + `/link` + `/auth/handoff`; OAuth untouched | **med (the main cost)** |
| Offline fallback | bundled local error page shown on webview load failure | low |
| Custom titlebar | `decorations: false` + CSS titlebar, or keep native | low–med |
| Launch-at-login, single-instance | `tauri-plugin-autostart`, `tauri-plugin-single-instance` | low |

CSP allowlist needed for: the prod origin, the Hocuspocus WSS endpoint, S3,
Google.

## Notifications (background)

- A **Rust-side poller** uses the keychain desktop Session as a Bearer token to
  poll the existing notifications endpoint on an interval, even when the window
  is minimized/in tray, and raises native notifications + updates the badge.
- Webview JS alone is insufficient: the OS suspends a hidden webview's timers, so
  JS-only polling stops exactly when background notifications are wanted.
- Clicking a native notification fires a `dalios://` deep link; the
  single-instance handler routes it into the running window (focus + navigate to
  the relevant route). Deep-link handling and single-instance must be wired
  together, not built as independent features.

## Build order

1. **Skeleton** — `WebviewWindow` at `https://os.dali.dartmouth.edu`, native
   menus, tray, **minimize-to-tray** close, launch-at-login, single-instance,
   **locked-down capabilities**, CSP allowlist, offline fallback page. (~1–2 days)
2. **Device-pairing sign-in** — `DevicePairing` table + `/auth/pair/{start,poll,
   approve}` + `/link` approve page + `/auth/handoff` cookie-plant; shell pairing
   UI + keychain storage of the desktop token; **shell intercepts `/login`
   redirects → re-pair** (first-run + session-expiry). OAuth code untouched.
   (~2–4 days, the bulk)
3. **Background notifications + badge** — Rust poller over the existing endpoint
   using the keychain token; `dalios://` click-through wired to single-instance.
   (~2 days)
4. **"Your devices" + revocation** — settings page listing paired devices
   (label, last-seen) with Revoke that kills the keychain Session. (~1 day)
5. **External-link + nav handling** — origin-based interception; verify
   downloads / save dialogs / PDF-DOCX export trigger native save. (~1 day)
6. **Auto-update + signing** — `tauri-plugin-updater` + signed `latest.json` on
   **S3**; macOS Developer ID + **notarization** + staple (first-time setup is
   its own chore). (~2–3 days)
7. **Polish** — custom titlebar, cookie-persistence verification (WKWebView),
   min-shell-version handling, deep-link routing edge cases. (~2 days)

**Realistic total: ~1.5–2 weeks for a polished macOS v1.** Backend changes are
additive only: the `DevicePairing` table, `/auth/pair/*`, the `/link` approve
page, and `/auth/handoff` — no edits to existing OAuth or loaders.

## Ongoing development model

- **New web features work in the desktop app for free.** Shipping to Fly *is* the
  update for web content — new route/loader/feature appears on deploy, no rebuild
  or release.
- **The web code stays desktop-agnostic except in narrow, named spots.** Prefer
  handling OS concerns in the shell (nav interception, downloads) over scattering
  `isTauri()` branches. The genuine web-side bridges:
  - **Sign-in** — driven by the shell via device pairing; `login.tsx` is
    untouched and the only new web surface is the additive `/link` approval page.
    There is **no** web-side `isTauri()` login branch.
  - **New external OAuth/redirect flows** (if any are added later) — must open in
    the system browser, never an in-webview redirect.
  - Downloads / file pickers / save dialogs and external links are handled
    shell-side (nav interception + native save), so feature devs don't branch.
  - No URL/address bar exists — keep "copy the URL bar" out of UI copy.

## Two independent update channels

- **Web content (your features):** updates instantly, server-side. Deploy to Fly
  → reload → new version. No version pinning, no store review. Covers ~all
  ongoing feature work.
- **Native shell (the Tauri binary):** updates via `tauri-plugin-updater` only
  when you cut a new desktop release — bump version, build + sign in CI, publish
  signed `latest.json`; app checks the feed, downloads + verifies in background,
  swaps on restart.
- **Cross-version contract (both directions):** the webview can be newer than the
  shell. Gate any future web feature that needs a new shell capability behind a
  version/capability check so old installs degrade gracefully. Additionally, the
  server returns a **minimum-supported-shell** signal so a security fix in the
  shell can *force* an update rather than only degrading.

## Build, release & project layout

- **Project location (open decision).** The Tauri app (Rust + config + icons)
  needs a home: a `desktop/` directory in this monorepo, or a separate repo.
  In-repo keeps it next to the `/auth/pair/*` server changes and shares secrets;
  separate repo isolates the Rust toolchain. **Recommend `desktop/` in-repo.**
- **Two distinct signing layers — don't conflate them:**
  - *Apple notarization* (Developer ID) — so Gatekeeper trusts the `.dmg`.
  - *Tauri updater key* — a **separate** minisign keypair that signs each update
    artifact; the public key is baked into the app, the private key is a CI
    secret. Required for `tauri-plugin-updater` to accept an update. Easy to miss
    because it's unrelated to Apple signing.
- **CI:** desktop builds need a **macOS runner** (GitHub Actions `macos-*`) to
  build → sign → notarize → staple → upload `.dmg` + `latest.json` to S3. This is
  a new workflow, separate from the web app's `test.yml` / `build-check.yml`.
- **App assets:** `.icns` app icon, a templated macOS tray icon (light/dark), and
  a `.dmg` background — design deliverables.
- **Bundle config:** declare the `dalios://` scheme in `CFBundleURLTypes` so
  notification click-through can cold-start the app; consider
  `tauri-plugin-window-state` to remember window size/position.
- **Testing:** the web app's existing Vitest/Playwright cover web behavior
  unchanged. The shell is mostly manual-tested — keep a smoke checklist (pairing,
  re-auth on expiry, background notification + click-through, updater, tray
  quit/restore) rather than heavy Tauri e2e for v1.

## Open follow-ups (remaining)

- Decide project location (`desktop/` in-repo vs separate repo) — recommend
  in-repo.
- Generate the Tauri updater signing keypair; store the private key as a CI
  secret, bake the public key into the app.
- Decide the desktop poller token's absolute TTL (longer than the webview
  session so notifications don't lapse mid-month).

- Provision the Apple Developer Program account + Developer ID cert; wire
  notarization + stapling into CI.
- Define the notification poll interval / backoff for the Rust poller
  (suggested default: ~30–60s, with backoff on errors).
- Confirm the S3 bucket/path for the `latest.json` update feed.

## Auth decision log

- **A2 device pairing (chosen).** Leaves OAuth + `login.tsx` untouched, web stays
  desktop-agnostic, naturally redeem-only, identical for Google/CAS. Cost: one
  approve click + poll loop + one additive table.
- **A1 piggyback OAuth (rejected).** Thread `client=desktop` through `/login` →
  Google `state` / CAS service URL → callbacks, with a loopback return + PKCE and
  an `isTauri()` login-page branch. More moving parts, spreads desktop-awareness
  through live OAuth code, and forces a web-side login branch.
- **A3 native OAuth client (rejected).** App as its own Google "Desktop" client.
  Still opens the system browser (so no UX win), duplicates server OAuth as a
  native client, doesn't solve CAS.
- **Planting** is invariant across all options (cookie-jar isolation): the
  `/auth/handoff` Bearer→cookie route is required regardless. Client-side cookie
  injection was rejected as fragile (limited Tauri v2 cookie-write support).
