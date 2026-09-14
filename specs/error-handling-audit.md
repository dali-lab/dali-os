# Error-handling audit — web + desktop

_Audit date: 2026-09-12. Read-only pass over `dali-api/` (web) and `desktop/` (Tauri shell)._

**Goal:** improve clarity of error states and eliminate "dead-end" screens — any screen
where the user is stranded with no link, button, or recovery action to get back to a
working part of the app.

---

## TL;DR

Two genuine dead-ends, one of which already has a ready-made fix sitting unused:

1. **Web root `ErrorBoundary` is a dead end.** The app-wide fallback renders bare
   `<h1>Oops!</h1>` / `404` text with **no link home and no retry**. This is what any
   route without its own boundary falls back to — including every unmatched URL (there's
   no catch-all route).
2. **Desktop shows a blank white window on load failure.** If the remote origin can't
   load (offline, server down, DNS), the WKWebView goes blank with no message and no way
   out but force-quit. A finished `offline.html` retry screen **exists but is never wired
   up.**

Everything else is either already good (pairing flow, portal boundaries, tab-empty state)
or a clarity/silent-failure gap rather than a hard dead-end.

---

## Web app (`dali-api/`)

### 🔴 DEAD END — Root `ErrorBoundary` (`app/root.tsx:93-129`)
The last-resort boundary for the whole app. Renders:
```
<main><h1>{message}</h1><p>{details}</p></main>
```
- 404 → "404" / "The requested page could not be found."
- Any other route error → "Error" / statusText
- Unexpected JS error → "Oops!" / "An unexpected error occurred." (stack only in DEV)

**No link, no button, no navigation.** User must manually edit the URL or hit browser
back. This is the fallback for every route that doesn't export its own `ErrorBoundary`.
**Highest-impact fix** — every uncaught error in the app lands here.

### 🔴 DEAD END — No catch-all / 404 route
Nothing matches unknown URLs, so a mistyped/stale link falls through to the root
boundary above → the same dead-end "404" text. No dedicated not-found page, no "go to
Home."

### 🟡 CLARITY — Action/permission errors returned as bare JSON
Actions `throw`/return `Response.json({ error }, { status: 403|404 })` (e.g.
`portal.application.tsx:115` "No application found", `intern-to-full.tsx` "Not a lab
member" / "Not eligible", education "Not enrolled"). There's no shared client layer that
surfaces these — display is per-route and inconsistent. Messages are terse and give no
next step.

### 🟡 SILENT — Uncaught errors log but show nothing
`AnalyticsErrorReporter` beacons `window.error` / `unhandledrejection` to
`/api/analytics/error` (deduped) but renders **no UI**. A client-bundle crash yields a
blank/frozen page with zero user-facing signal (this is the "No tabs open" class of
failure noted in project memory).

### ✅ GOOD (leave alone)
- **`ApplicantErrorBoundary`** (`app/components/ApplicantErrorBoundary.tsx`) — the model
  to copy. "Try again" (revalidate) + "Back to portal" / "Reload page". Used by
  `applicant-layout`, `portal`, `portal.application`, `portal.hiring`, `portal.apply`.
- **Tab-empty state** (`TabWorkspace.tsx:1781`) — "No tabs open. Click a section in the
  sidebar." Sidebar always present → clear path out. Not a dead end.
- **Auth guards** — loaders `redirect("/login")`; user can re-auth and continue.
- **Inline booking errors** (`portal.hiring.tsx`) — red inline boxes with retry context.

---

## Desktop app (`desktop/` — Tauri v2 WKWebView shell)

### 🔴 DEAD END — Blank window on remote load failure (`src-tauri/src/window.rs:38-46`)
Main window is `WebviewUrl::External(prod)` with only an `on_navigation` hook
(`nav.rs` — handles `/login` re-pair + cross-origin only). **There is no load-failure
callback** (`on_page_load` / resource-error). Offline, server-down, DNS failure, or
timeout → **blank white WKWebView, no message, no retry.** Force-quit is the only way out.

**Ready-made fix, unused:** `desktop/frontend/offline.html` is a finished "Can't reach
DALI OS" card with a Retry link back to the prod origin. Nothing navigates to it. The
`main-remote.json` capability comment even documents its retry mechanism — so it was
designed in, just never wired. Wiring a load-error → `navigate_main(offline.html)` closes
this dead end.

### 🟡 CLARITY — No splash / loading state on cold start (`src-tauri/src/window.rs`)
Windows are built `.visible(false)` and shown only after setup. If the remote load is slow
or hangs, the user stares at empty desktop with no spinner/indicator. Not a hard dead-end
(no window shown) but no feedback.

### 🟡 RESILIENCE — Startup panic (`src-tauri/src/lib.rs:140`)
`.expect("error while running DALI OS desktop")` — a Tauri init failure crashes with a raw
panic and no user-facing message. Low probability, high severity.

### 🟡 CLARITY — Token-expiry surfaces only as a banner (`src-tauri/src/poller.rs`)
On 401 the poller emits a "Sign-in expired — open DALI OS to sign in again" notification
and exits. If the user misses the banner there's no in-app prompt until they hit a
`/login` redirect. (5xx poll failures back off silently — acceptable.)

### ✅ GOOD (leave alone)
- **Pairing window** (`pairing.rs` + `frontend/pairing.js`, `index.html`) — full error
  states (failed / expired / denied / already-used) each with **Try again** + cancel.
  This is the desktop model to match.
- **Auto-updater** (`updater.rs`) — every failure path surfaces a non-blocking native
  notification; app keeps running. No dead end.
- **`/login` re-pair interception** (`nav.rs:22-37`) — lapsed session cleanly re-triggers
  pairing.

---

## Recommended fixes (prioritized)

| # | Fix | Where | Effort |
|---|-----|-------|--------|
| 1 | Give root `ErrorBoundary` a way out — "Go to Home" link + "Reload"/"Try again", clearer copy, distinguish 404 vs crash | `app/root.tsx` | S |
| 2 | Wire desktop load-failure → show `offline.html` (already built) | `src-tauri/src/window.rs` + a load-error handler | S–M |
| 3 | Add a catch-all `$.tsx` (or splat) 404 route with Home link | `dali-api/app/routes/` | S |
| 4 | Cold-start splash/loading state in desktop main window | `desktop/` | M |
| 5 | Shared client surface for action/permission errors (toast or inline) + friendlier copy w/ next step | web | M |
| 6 | Optional: minimal user-facing fallback for uncaught client crashes (beyond silent beacon) | web | M |
| 7 | Harden desktop startup panic + auto-show pairing on token expiry | `lib.rs`, `poller.rs` | S |

Items **1–3** remove the two hard dead-ends and are small, high-leverage, low-risk.
Reuse `ApplicantErrorBoundary` (web) and `offline.html`/pairing patterns (desktop) rather
than inventing new UI.

---

## What was built (2026-09-12)

Verified against latest `staging` (the initial audit was run against a stale
`origin/dev` worktree; every finding above was re-confirmed on staging before
building — the two dead-ends and the orphaned `offline.html` all held).

### Web (`dali-api/`) — typecheck clean, unit tests green
- **`app/components/ErrorScreen.tsx`** (new) — shared presentational error card
  (icon + heading + description + action slot + dev-only stack). One canonical
  look; every use must render at least one recovery action.
- **`app/root.tsx`** — root `ErrorBoundary` now renders `ErrorScreen` with a
  **"Go to home"** link (plain `<a href="/">` — a full-document load is the
  robust way out even if a render crash wedged the client router) and a
  **"Reload page"** button, plus clearer 404-vs-crash copy. This is also the
  unmatched-URL path (RR routes unknown URLs here as a 404 → "Page not found"
  with a way home), which folds in the "catch-all 404" item — no redundant
  splat route needed.
- **`app/components/ApplicantErrorBoundary.tsx`** — refactored to reuse
  `ErrorScreen` (DRY); behavior/actions unchanged.
- **`app/lib/useActionErrorToast.ts`** (new) + test — reusable hook that surfaces
  a fetcher/action `{ error }` result as a toast (dedupes by result identity, so
  a retry with the same message re-fires but re-renders don't). Adopted only in
  the genuinely-silent drag cases (staging already surfaces most action errors
  inline, so a blanket sweep would double-toast):
  - `app/calendar/routes/calendar.tsx` — `eventMoveFetcher` (drag-move/delete).
  - `app/education/components/ManageCourseContent.tsx` — `moveFetcher` +
    `sessionFetcher`.

### Desktop (`desktop/`) — cargo-checked; needs on-device validation
- **Offline fallback** (`window.rs`, `nav.rs`, `state.rs`, `config.rs`) — the main
  window now wires `on_page_load` + a load-generation watchdog. On cold start a
  reachability probe runs: reachable → reveal the app; **unreachable → swap the
  main window to the bundled `offline.html`** instead of a blank webview. The
  watchdog is gated on an actual reachability probe, so a missed load-finished
  signal (e.g. an occluded hidden webview) can **not** false-positive to
  "offline" on a working connection. `nav.rs` now allows the `tauri://` asset URL
  (so the offline page loads in-webview rather than being shunted to the browser)
  and re-arms the watchdog on post-launch navigations (covers the offline page's
  Retry link).
- **Cold-start splash** (`window.rs`, new `frontend/loading.html`) — a branded
  loading window shown while the app loads, closed on reveal / offline. Reuses
  `pairing.css` (`.card`/`.logo`/`.spinner`). Uses no IPC → needs no capability.
- **Token-expiry re-pair** (`nav.rs`) — `/login` interception now re-triggers
  pairing on `TokenExpired` too (not only `Authenticated`), so a lapsed session
  the poller already flagged isn't stuck on the embedded (Google-blocked) login.

**Device-test checklist (untestable in this environment — no Rust runtime UI):**
1. Cold start with Wi-Fi off → offline card (not blank); Retry with Wi-Fi on →
   app loads.
2. Confirm the asset URL `tauri://localhost/offline.html` resolves in the main
   window (macOS Tauri v2 asset scheme).
3. Kill the connection mid-session, navigate → offline card appears within ~12s.
4. Splash shows briefly on a normal cold start and closes cleanly.
5. Revoke the desktop session (poller 401) then hit a `/login` redirect →
   pairing re-opens.

### Deliberately not built
- Separate global uncaught-error overlay (beyond the root boundary): the root
  `ErrorBoundary` catches React render crashes, which is the dominant case, and
  a blanket window.onerror overlay would be noisy. `AnalyticsErrorReporter` stays
  beacon-only.
- Broad `useActionErrorToast` rollout: staging already surfaces most action
  errors inline; wiring the toast everywhere would double-surface. The hook is
  available for future/swallowed cases.
- Hardening the `lib.rs` build-time `.expect(...)`: a Tauri init failure is
  unrecoverable (no runtime to render a message), so there's nothing useful to
  show.
