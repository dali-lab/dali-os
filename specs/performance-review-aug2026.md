# DALI OS Performance Review — August 2026

Follow-up to the July 2026 review (`specs/performance-review.md`, PR #931). Focus
per request: home/shell/sidebar first, then app-wide; both backend (loaders/DB)
and frontend. Findings are ranked by **real user-facing impact**, which is not
the same as raw byte counts — see the bundle section for why.

## TL;DR

- The shell, auth, and home loaders are **already well-optimized** (PR #931 +
  #1172): two-wave `Promise.all`, per-request memoization of `requireAuth` /
  `loadShellUser`, throttled heartbeat writes, `shouldRevalidate` on the layout.
  Don't re-litigate these.
- The dominant driver of *perceived* "everything got slower" is **architectural,
  not a single slow query**: the iframe-per-tab shell reboots the whole app on
  every sidebar click, and `shouldRevalidate` is absent on all but 2 of 107
  routes so interactions re-run full loader chains.
- The scary-looking "6.6MB Prisma in the client bundle" is **build bloat on
  resource-route chunks the browser never fetches**, not download cost. Half of
  its mechanism (a module-load `setInterval` in `~/lib/rate-limit`) *did* reach
  real rendered pages (login) and is now fixed, with a regression guard added.

---

## Implemented this pass (quick wins)

Branch `perf/client-bundle-leak` (off `origin/staging`).

### 1. Removed the module-load side effect in `~/lib/rate-limit`
`rate-limit.ts` started its cleanup `setInterval` at module load. A top-level
side effect can't be tree-shaken, so rolldown pinned the module — and anything
in its retained subgraph — into the client bundle of every route that imports it
(directly or transitively via the very widely-imported `~/lib/audit`). The
module's own comment records that this previously "took down the activity
viewer."

Fix: start the sweep lazily on the first `checkRateLimit()` call. The module is
now side-effect-free.

Verified against a fresh `npm run build`:
- `login.tsx` / `partner.login.tsx` (real **component** routes that render and
  import rate-limit) no longer ship the rate-limiter code — `setInterval`
  occurrences in the login chunk went from present to **0**.
- No component-bearing route ships the Prisma/db chunk.

### 2. Regression guard: `app/lib/__tests__/client-bundle-leak.test.ts`
The July review flagged that no CI check existed for this class of leak. Added a
Vitest guard that reads the built React Router manifest and **fails if any
route with `hasDefaultExport` (i.e. one the browser actually loads) ships a
`db-` / `query_compiler` / `prisma` chunk.** Resource routes (loader/action
only) are exempt because the browser never fetches their client module. The test
is a no-op when there's no build artifact, so it never blocks the unit-test job;
it bites in build-check / local post-build runs.

Passing now (0 component routes leak). `npm run typecheck` clean for changed
files (remaining errors are the pre-existing `scripts/` baseline).

---

## The Prisma/db "leak", precisely (why it's low-severity)

The client build ships `db-*.js` (1.8MB) + `query_compiler_fast_bg.postgresql.wasm`
(4.8MB). Mechanism:
- `~/lib/db` instantiates `PrismaClient` at module top — a side effect. Being a
  non-`.server` file, it *can* land in client chunks.
- A route with a **direct** top-level `import { prisma } from "~/lib/db"` retains
  a bare `import "./db"` even after RR strips its loader/action, because rolldown
  preserves side-effectful imports. Routes that reach Prisma only through a
  `*.server.ts` helper get fully stripped (Vite replaces `*.server` with an empty
  client module).
- Today exactly 4 routes leak it: `api.ai.doc`, `api.comments`, `api.comments.$id`,
  `api.sprints.$id`. **All are resource routes with no default export**, so the
  browser never requests these chunks. Impact today = build-artifact size + risk.

**Recommended durable fix (not done — needs your call):** either (a) enforce via
convention/lint that resource routes reach Prisma through a `*.server.ts` helper
rather than importing `~/lib/db` directly, or (b) rename `db.ts` → `db.server.ts`
(mechanical but touches hundreds of imports + the `__mocks__` path). The new
guard already prevents the *dangerous* case (a rendered route leaking it), so
this is cleanup, not urgent.

---

## Ranked findings & recommendations (not yet implemented)

### A. iframe-per-tab shell — biggest perceived-speed lever
Every sidebar navigation boots a fresh iframe: re-download + re-parse the ~543kB
(uncompressed; ~160kB gz) eager graph (entry + root + layout) and re-run the
shell loader (~12–18 queries). Deep links boot twice. This is what makes the app
feel heavier the more you click around.

Tabless mode (PR #923) renders routes directly in the shell and eliminates this
class. It's opt-in behind `Settings → Workspace` and cookie-backed.

**Recommendation:** make tabless the default (it's already flag-gated — flip the
default, keep the escape hatch), roll out to Core first, watch the PSI/nav-timing
numbers. This is the single highest-ROI change and needs a product decision more
than engineering.

### B. `shouldRevalidate` coverage — 2 of 107 routes
Under RR7 single-fetch, a fetcher submission or any search-param change
revalidates **every** active loader in the matched chain by default. Only
`layout.tsx` and `projects.$id.tsx` opt out.

Caveat that makes this *targeted, not blanket*: most page loaders legitimately
read their own searchParams (e.g. `members` reads `?status`/`?domain`,
`lead.cycle.$id` reads `?tab`), so suppressing revalidation on search changes
would break filtering. The safe pattern is `projects.$id`'s: skip revalidation
only for search-param-driven **UI state the loader ignores** (drawer opens like
`?task=`, `setSearchParams({replace:true})` filters resolved client-side), and
allowlist mutating form actions.

**Recommendation:** audit these searchParam-using routes case by case and add a
`projects.$id`-style `shouldRevalidate` where the params are UI-only:
`forms.responses.$formId`, `mentorship.browse`, `education.manage.$offeringId`,
plus any board/drawer page. Measure loader-call counts before/after in the
network panel. High felt-value on interaction latency; low risk when done per
route with knowledge of what the loader reads.

### C. `/api/notifications` over-fetch on the 60s bell poll
`NotificationBell` polls `/api/notifications` every 60s (+ SSE pushes) but uses
only `taskCount` / `tasks`. The endpoint additionally runs `listMyNotifications`
(feed items with bodies) + a `notificationPreference.findMany` on every hit. The
feed panel and desktop banners share this route (CLAUDE.md marks it
desktop-critical → additive changes only).

**Recommendation:** add an additive `?tasksOnly=1` param that returns just the
tasks payload and have `NotificationBell` use it; leave the full payload for the
feed/desktop consumers. Cuts a recurring per-user DB cost with zero desktop risk.

### D. Eager initial-load JS ≈ 543kB uncompressed (~160kB gz) — acceptable
Largest eager chunks: react-router runtime (175kB), shared vendor (117kB),
`layout` (95kB), `floating-ui.react` (73kB). `floating-ui` is shell
tooltips/popovers — legitimately needed on every page. Nothing here is alarming;
this is not the bloat users feel. Revisit only after A/B land.

### E. Ruled out
- **`resolvePhotoUrl` in `.map(async …)` loops** across members/admin/projects/
  partners is **not** an N+1: `getDownloadUrl` uses `getSignedUrl` (local HMAC
  presign, no network round trip). Leave as-is.
- Shell/home/auth loaders: already parallelized + memoized. No change.

---

## Tests / measurements to run

1. **Bundle guard** (added): `npx vitest run app/lib/__tests__/client-bundle-leak.test.ts`
   after a build. Wire into the build-check flow if desired (workflow edits are
   out of scope for this branch).
2. **PageSpeed on PR previews** (existing infra, PR #934): compare Home mobile
   before/after a tabless-default experiment against the 83 baseline.
3. **Loader-call counting**: in DevTools Network, filter `.data` requests and
   count per interaction (drawer open, filter change) on a heavy board page
   before/after adding `shouldRevalidate` — expect the count to drop from N to 0
   for UI-only param changes.
4. **Nav-timing under tabless vs tabbed**: record `navigation` PerformanceEntry
   duration for a sidebar click in each mode; the iframe boot cost is the delta.
