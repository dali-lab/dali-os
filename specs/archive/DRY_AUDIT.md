# DRY Audit — DALI OS (`dali-api/`)

Worktree: `.claude/worktrees/dry-analysis` on `worktree-dry-analysis` (off `origin/dev` @ `5fc083b`).
Audit performed: 2026-06-14. Research-only — no files changed.

Methodology: 6 parallel research agents covered separate axes (auth/role-gating, Prisma queries, constants/magic values, validation/Zod, UI components, integration glue + dates). All findings include `file:line` evidence.

---

## Top of the funnel — highest-leverage findings

These are the items that came up in **multiple** axes and have real correctness/drift risk.

### 1. No canonical "who is this user?" identity layer

- `daliEmail ?? dartmouthEmail ?? personalEmail` inlined 13×
- `${user.netId}@dartmouth.edu` reconstructed 11×
- `${firstName} ${lastName}` reinvented 25× (about half unsafe — no `?? ""`, will render `"undefined undefined"`)
- `"Unknown"` and `"—"` compete as missing-field sentinels

`app/routes/portal.apply.tsx:450` already has the email fallback in the **wrong order** (`dartmouthEmail ?? daliEmail` — every other site prefers `daliEmail` first).

Missing helpers: `primaryEmail(user)`, `fullName(user)`, `displayEmail(user)`, `DARTMOUTH_EMAIL_DOMAIN` constant.

### 2. No canonical "is this user authorized?" layer above `requireAuth`

`requireAuth()` is well-adopted (516 imports), but the 4–6 lines *after* it are open-coded ~50× per pattern:
- "if applicant redirect to portal" — 48 copies
- "if not Core return 403 with CORS-wrapped JSON" — 50+ copies
- "if not Core-or-DomainLead return 403" — ~10 copies

Three different `Unauthorized` response shapes coexist; four different `Forbidden` shapes coexist (`withCors`-wrapped JSON / bare `Response.json` / `new Response(JSON.stringify(...))` / plain text).

Missing helpers: `requireCore(auth)`, `requireCoreOrDomainLead(auth)`, `requireMemberSession(request)`, `forbidden(request)`, `unauthorized(request)`.

### 3. Three competing "is user Core?" implementations with different semantics — CORRECTNESS RISK

- **Canonical** (`app/lib/roles.ts:83 isCore()`) — honors Admin override + cycle-window scope
- **List-view inline** (`u.coreAssignments.length > 0`) in 5 loaders — ignores Admin override AND cycle scope
  - `app/admin-console/routes/api.members.ts:62`
  - `app/admin-console/routes/admin-console.members.tsx:62`
  - `app/admin-console/routes/admin-console.domains.tsx:80`
  - `app/mcp/tools/search-directory.ts:108`
  - `app/mcp/tools/get-member-profile.ts:92`
- **Staffing inline** (`coreAssignment.findMany({ termId })`) in `app/projects/routes/api.staffing.finalize.ts:352` and `api.staffing.term-channel.ts:88` — ignores cycle-window scope

**Impact:** A user granted Admin only via `ADMIN_USER_IDS` env will appear `isAdmin=false` in every list view but `isAdmin=true` in route gates. This is the single highest correctness risk in the audit.

### 4. Two competing "current term" helpers with different inter-term-gap behavior

- `app/lib/roles.ts:186 currentTerm()` — falls back to next upcoming term in the inter-term gap
- `app/lib/groups.ts:90 getCurrentTermId()` — returns `null` in that gap

Both are called "current term" in code. Plus three open-coded copies in `app/hiring/lib/intern-eligibility.ts:11,35,58` (intentional, per comment, but it's the same query thrice).

### 5. `<Button>` and `<Modal>` primitives exist and are essentially unused

`app/components/ui/Button.tsx` and `app/components/Modal.tsx` are well-designed (Modal has focus-trap + Escape + scroll-lock + focus restore). But:

- `bg-accent-coral text-white hover:bg-accent-coral/90` — 77 hand-rolled coral primary buttons
- 8+ modals hand-roll `fixed inset-0 z-50 bg-black/40` overlays despite `Modal.tsx` being correct
- Net: ~85 sites reimplementing what the design system already ships

### 6. Two parallel environment systems

- `NODE_ENV === "production"` — branches cookie security / security headers / dev gates (~20 sites)
- `getAppEnv()` (returns `'dev' | 'staging' | 'prod'`) — branches email staging banners (2 sites)

On Fly.io, **staging is `NODE_ENV=production`**, so the two axes disagree. The wrong branch can fire on staging silently.

### 7. Three implementations of session lookup

`app/lib/auth.ts:requireAuth`, `app/lib/mcp-auth.ts:authenticateMcpRequest`, `app/collab/auth.ts:verifyCollabToken` — same DB read + expiry + revoke checks, three different response shapes (HTTP/JSON, JSON-RPC, thrown strings). All three share `cookies.ts` for parsing but diverge for everything else.

### 8. Google OAuth token refresh hand-rolled 5×

`app/lib/gmail.ts:11`, `app/lib/google-calendar.ts:45`, `app/lib/oauth.ts:238`, `app/routes/integrations.calendar.google.callback.ts:69`, `app/routes/admin.authorize-gmail.callback.ts:60` — same `POST https://oauth2.googleapis.com/token` with different error wrappers and different env-var resolution. The four Google-authorize-redirect handlers are similarly near-twins with three different state-cookie names (`__dali_oauth_state`, `__dali_gmail_oauth_state`, `__dali_cal_oauth_state`) and two different state-length conventions (16 hex vs 32 base64url).

### 9. `"America/New_York"` typed literally in 9 files

Despite `app/lib/timezone.ts:2` exporting `APPLICATION_TZ`. Same for `" ET"` label vs `APPLICATION_TZ_LABEL`. Sites:

- `app/calendar/routes/calendar.tsx:29`
- `app/lib/availability.ts:244`
- `app/hiring/lib/interview-time.ts:6`
- `app/hiring/lib/interview-emails.ts:31`
- `app/hiring/lib/extension-notice.ts:25`
- `app/hiring/lib/interview-notifications.ts:32`
- `app/hiring/routes/api.cycles.$cycleId.interview-config.ts:83,96`
- `app/hiring/routes/api.cycles.$cycleId.coverage.ts:22`
- `app/hiring/routes/lead.cycle.$id.tsx:1181`

### 10. 30-day session window stored as 3 independent constants

- `app/lib/session.ts:7 ROLLING_TTL_MS = 30 * 24 * 60 * 60 * 1000`
- `app/lib/session.ts:8 ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000` (same value, separate name)
- `app/lib/cookies.ts:10 SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60`

The existing comment at `cookies.ts:5-9` even admits "independently enforced." Rotating the window to 14 days requires three edits.

---

## Domain-by-domain — critical drift hits

### Auth / sessions / role gating

- **`coreAssignments.length > 0` open-coded as "isCore"** in admin-console, members, MCP loaders. Ignores Admin-env override.
- **"Core OR Domain-Lead" gate copied ~10× across hiring** with subtly different forms (sequential awaits, parallel `Promise.all`, single-line). No `requireHiringLead` helper.
  - `app/hiring/routes/api.delibs.$id.moves.ts:24-26`
  - `app/hiring/routes/api.delibs.$id.ts:41-43`
  - `app/hiring/routes/api.cycles.$cycleId.delibs.ts:40-42`
  - `app/hiring/routes/api.cycles.$cycleId.interviewers.ts:57-59`
  - `app/hiring/routes/api.decisions.$id.finalize.ts:20-22`
  - `app/hiring/routes/api.domain-applications.$id.decisions.ts:86-88`
  - `app/hiring/routes/api.cycles.$cycleId.reviewers.ts:41`
  - `app/hiring/routes/library.tsx:18-23,68-73`
- **"Owner OR DomainLead OR Core" gate** repeated 3× across `api.reviews.$id.*` files (`submit.ts:40`, `unsubmit.ts:33`, `ts:179`).
- **`api.* action prologue` is ~50 sites of identical 4-line preflight+auth+method+gate boilerplate** in `app/projects/routes/api.*.ts`.
- **MCP tool prologue duplicated across 28 tools** — every `app/mcp/tools/*.ts` declares its own `class XxxError extends Error` and re-checks `isCore`.
- **`canEdit` (project) disagrees with API gates.** `projects.$id.tsx:240` says `canEdit = core || isProjectMember`, but every project mutation API checks `isCore` only — UI offers edit affordances that the API silently 403s.
- **"Admin OR self"** done 3× in `members/lib/profile-page.server.ts:207,294,306` with 3 separate `isAdmin(...)` DB reads in one request.
- **`ADMIN_USER_IDS` env parse repeated 3× in `roles.ts`** (lines 33, 84, 104).
- **"Not a DALI member" 403 boilerplate** in 11 hiring routes despite `roles.ts:173 requireMember()` existing and being used in only 3 places.

### Prisma queries

- **Staffing-board user select shape duplicated 3× in `projects.staffing.tsx`** (lines 122, 293, 329), and 5 more times elsewhere as the "lab member with role badges" shape.
- **Nested `user: { select: { firstName, lastName } }` ("name card" mini-select) in 20+ files.** Plus the variant adding `daliEmail` in another 9.
- **`{ daliMember: { isNot: null } }` "lab member" filter inlined 11×.**
- **`orderBy: [{ lastName: "asc" }, { firstName: "asc" }]` duplicated in 10 member-list loaders.**
- **`deriveCoreTitles` is a byte-identical helper in `members.tsx:134` and `members.groups.tsx:128`.** Two more sites (`projects.staffing.tsx:258`, `admin-console/routes/api.members.ts:63`) infer the same thing with three different dedupe rules.
- **`role badges triple` (`adminMembership` + `coreAssignments` + `domainLeadAssignmentsAsUser`) duplicated 8×** with subtly different sub-selects. `search-directory.ts` filters `coreAssignments` by `termId`; `members.tsx` does not — so "isCore" silently differs by call site.
- **`domain: { select: { id, displayName } }` and `displayName`-only** declared 25+ times. Also one site uses `domain: { select: { id, name } }` (note `name`, not `displayName`) at `projects.$id.tsx:124,196`.
- **Sequential per-domain upsert loop in `app/hiring/lib/domain-application.ts:37-63`** — not wrapped in `$transaction`.

### Constants & magic values

- **`process.env.API_BASE_URL ?? <fallback>` repeated 14×** with three different fallbacks: `localhost:3001` (10×), `localhost:5173` (1×), `https://os.dali.dartmouth.edu` (2×). One file (`oauth.authorize.ts:144`) has the dev-port wrong.
- **`Level = "P1" | "P2" | "P3"` redefined in 6 files**; only one (`admin-console/lib/eligibility.ts:6`) exports `ALLOWED_LEVELS`. The Prisma enum is deliberately avoided per comment in `bid-validation.ts:16`. `api.staffing.assign.ts:39` hand-rolls `if (o.level !== "P1" && o.level !== "P2" && o.level !== "P3")`.
- **`applications@dali.dartmouth.edu` typed as a literal in 4 separate files** including 3 redundant `const GMAIL_USER = '...'` definitions (`gmail.ts:6`, `gmail-integration.ts:7`, `admin.authorize-gmail.callback.ts:10`).
- **Staffing preference cap (`3`)** hardcoded in `bid-validation.ts:58` *and* in MCP prompts *and* in comments — even though `cycle.maxPreferencesPerMember` exists in the DB.
- **`DAY_KEYS = ["SUN", "MON", ...]`** declared verbatim in `calendar.tsx:3173` and `home.tsx:617`.
- **`@dali.dartmouth.edu` and `@dartmouth.edu` domain literals in 12+ files.** `WORKSPACE_DOMAIN` constant exists in `google-workspace.ts:27` but only used inside that one file.
- **CAS_BASE_URL fallback `"https://login.dartmouth.edu/cas"` inlined 5×.**
- **`"Forbidden"` JSON 403 hand-rolled 128×; `"Unauthorized"` 11×.** No `forbidden()` / `unauthorized()` helper.
- **Cycle-start season-digit arithmetic uses bare magic numbers `9, 10, 1, 2`** at `roles.ts:228-230,248-249`. The fact that `W=1, S=2, X=3, F=4` is implicit in seed data; the math re-derives it inline.

### Validation / FormData

- **`safeJsonParse` declared byte-identically in 3 project routes** (`projects.project-bids.tsx:236`, `projects.intent-to-work.tsx:237`, `projects.level-up.tsx:381`) plus a near-twin pair in `forms-data.ts:211` / `public-form.ts:41`.
- **The same id schema (`z.string().min(1).max(100)`) declared 17× across hiring/admin-console**, with another ~30 routes using `z.string().min(1)` (no cap) for the same conceptual fields.
- **At least 4 different `Response.json({ error }, { status: 400 })` shapes** for the same Zod-rejected event: `{ error, details }`, `{ error }`, `{ error, status }`, `{ ok: false, reason }`. The calendar action schema parsed in two routes returns *different* shapes for the same schema (`calendar.tsx:332` vs `settings.calendar.tsx:96`).
- **Hand-rolled `validateReviewPatch` in `api.reviews.$id.ts:39-160`** — 120 lines of imperative type-checking re-implementing Zod, plus a second copy of `VALID_RECOMMENDATIONS`.
- **`NoteVersionSchema` declared byte-identically in 2 hiring routes** (`api.cycles.$cycleId.my-interviews.$interviewId.notes.ts:9`, `api.interview-assignments.$id.notes.ts:9`).
- **Empty-string-to-null (`x === "" ? null : x`)** repeated 20+ times with three subtle variants (raw / `.slice(0,80)` / `.trim()`).
- **Boolean-from-string** has at least 4 idioms (`=== "true"`, `=== "1"`, `Boolean()`, parseInt-then-check).
- **No `.email()` call in the entire `app/` tree.** One ad-hoc regex (`api.email.send.ts:50`), one substring check (`profile-page.server.ts:328`).
- **`parseJson()` adoption is half-done** — 41 routes use it, 8+ still hand-roll `safeJson + try/catch + safeParse`.
- **Three ISO-datetime semantics**: `Date.parse(s)` refine (accepts "2024-13-01" silently), `z.string().datetime()`, `z.string().datetime({ offset: true })` — same logical field, three behaviors.
- **75-line `coerceFormToAction` in `calendar.tsx:544`** reimplements what `z.coerce.*` + `z.preprocess` could fold into the schema.

### UI / components

- **77 hand-rolled coral primary buttons** (`bg-accent-coral text-white hover:bg-accent-coral/90`) — `<Button>` primitive has zero usage outside its own file.
- **8+ hand-rolled modal overlays in `hiring/components/`** (Library lines 193/325/466, EmailTemplates, ApplicantContextModal, calendar personal-block popover, FormsBrowser folder-rename) bypass `Modal.tsx`. Drift includes missing Escape handling and inconsistent close-button styling.
- **3 near-identical `Avatar` components** in `members.tsx:517`, `members.groups.tsx:844`, `MemberCard.tsx:196` — same fallback chip styling, different sizes.
- **5 redefinitions of `STATUS_COLORS` / `DECISION_COLORS`** in hiring. `domain-lead.application.$id.tsx:42` uses `bg-purple-100` for `InvitedToInterview` while every other site uses `bg-blue-100` — visible drift.
- **`formatDateTime` declared byte-identically in 4 hiring detail components** (`ConfidentialityAgreementDetail.tsx:8`, `EmailTemplateDetail.tsx:11`, `ChallengeDetail.tsx:10`, `RubricDetail.tsx:13`). Same files also each redefine `memberLabel`.
- **3 user-picker UIs** (`AddMemberControl.tsx`, `admin-console.announcements.tsx`, `calendar.tsx`) — three completely different shapes for the same job.
- **Form-row `<label><input/>` pattern inlined 34×** with two competing styles: design-token (`border-border`) vs. hiring-legacy (`border-gray-300 focus:ring-blue-500`). The hiring style ignores theme tokens and won't theme correctly.
- **Table thead `bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide` copy-pasted 7×.**
- **Spinner `border-2 border-X border-t-Y rounded-full animate-spin` reimplemented 8×** plus 3 `<Loader2 className="animate-spin">` usages — no shared `<Spinner>`.
- **Empty-state "No X yet" pattern repeats ~25×** in 3 different visual styles.

### Integration glue + dates

- **Google token refresh hand-rolled 5×** (top-of-funnel #8). Plus 4 authorize-redirect handlers with 3 different state-cookie names.
- **`zonedWallTimeUtc` reimplemented 3×** in `general-calendar.ts:231`, `hiring/lib/scheduling.ts:570` (line-for-line copy), `api.calendar.group-availability.ts:85` — despite `lib/timezone.ts:104` being canonical.
- **3 near-identical email-time formatters** (`interview-emails.ts:24`, `interview-notifications.ts:25`, `extension-notice.ts:23`) with different weekday widths and ET-suffix conventions.
- **`getGmailRefreshToken()` declared verbatim in two hiring lib files** as a 1-line thin wrapper around the same import.
- **Slack channel-sanitizer differs between server and client** (`slack-client.ts:218 sanitizeChannelName` vs `StaffingBoard.tsx:461 deriveTermChannel`) — client allows `_`, server collapses it to `-`. A name accepted in the UI is silently rewritten by the server.
- **4 different "Slack not configured" shapes** across `slack-client.ts:20,129`, `api.staffing.finalize.ts:293`, `api.staffing.term-channel.ts:63`.
- **CSV cell escaping is private to `admin-console/lib/payroll-export.ts:56`** — no shared `csv.ts` helper. The second CSV exporter will hand-roll it again.
- **`SLACK_INVITE_USER_SELECT` shape declared 3×** (`api.staffing.finalize.ts:47`, `api.staffing.term-channel.ts:80` inline, `members/lib/slack-sync.server.ts:14` inline).
- **PEM newline-restoration (`\\n` → `\n`) for Fly secrets** done twice — `github.ts:19 decodePem` and inline at `google-workspace.ts:86`.
- **Random-token generation** scattered across 5 files with two ladders (16 hex for OAuth state, 32 base64url for sessions); `oauth.ts:84 generateOpaqueToken()` exists but isn't reused.
- **Retry ladder `[500, 1000, 2000, 4000, 8000]`** hand-rolled at `google-workspace.ts:252` — the only retry in the codebase. The "staffing retry Google group adds" commit (#818) didn't factor it out.

---

## Already-DRY patterns worth extending

The codebase has the right *primitives* in many places — they're just under-adopted. These are the canonical patterns to mimic.

- **`requireAuth()`** (`app/lib/auth.ts:85`) — 516 imports. Right shape; missing the `requireCore` / `requireCoreOrDomainLead` siblings.
- **`getUserRoles()`** (`app/lib/roles.ts:32`) — single parallel role fan-out; used by ~5 loaders correctly. The 100+ "two sequential `await isCore + await isDomainLead`" sites should funnel here.
- **`hasCycleAccess(userId, cycleId)`** (`app/lib/roles.ts:277`) — model for the missing "core-or-domain-lead" helper.
- **`logAuditEvent()`** (`app/lib/audit.ts:66`) — 100+ uniform call sites + a closed `AUDIT_ACTIONS` array. Best-in-class.
- **`google-workspace.ts`** — discriminated-union `{ status, message }` results, `workspaceConfigured()` predicate, idempotent `ensure*` upserts. The model for every other integration module.
- **`slack-client.ts:ensureChannel`** — get-or-create with `name_taken` handling. Right pattern.
- **`lib/timezone.ts`** — `zonedWallTimeUtc`, `zonedDayStartUtc` are correct. The problem is 3 other files reimplement them.
- **`lib/file-validation.ts`** — `MAX_UPLOAD_BYTES`, `fileMatchesAccept` shared correctly across 7 callsites.
- **`lib/word-count.ts`** — same algorithm shared between portal form and live counter.
- **`parseJson(request, schema)`** (`app/lib/validate.ts:13`) — clean drop-in adopted by 41 routes uniformly. Missing the `parseForm()` counterpart.
- **`hiring/lib/email-variables.ts`** — slot-keyed template variables with a CI-pinned test. Right shape for shared templates.
- **`forms/lib/forms-data.ts:runFormsAction`** — single action runner shared by 3 route entrypoints. Model for other feature modules.
- **`REGISTRAR_DATES`** (`prisma/seeds/v0-reference.ts:88`) — single source of truth for the registrar calendar with sync comment.
- **`COOKIE_SID = "__dali_sid"`** (`app/lib/cookies.ts:3`) — properly centralized.

---

## Outstanding questions

These need a decision before any refactor work:

1. **"isCore" semantic divergence (#3) — which behavior is correct?**
   Should `ADMIN_USER_IDS` env-only admins appear as `isCore=true` in member lists? Today they don't, but route gates treat them as Core. This is a security-relevant decision, not just DRY.

2. **`currentTerm()` vs `getCurrentTermId()` inter-term-gap behavior (#4) — null or fallback?**
   In the gap between, say, 26S and 26X, should "current term" return null or roll forward to 26X?

3. **Project `canEdit` (auth #5) — stale artifact or intended permission?**
   `projects.$id.tsx:240` permits project members to attempt edits the API will then 403. Is the loader's `canEdit` the desired permission (and the API gates are too strict), or vice versa?

4. **Modal/Button adoption strategy.**
   One big migration pass or split by domain (hiring vs projects vs forms)?

5. **Migration ordering.**
   Roughly suggested order if you want to act on this:
   1. Identity-layer helpers (`primaryEmail`, `fullName`, `DARTMOUTH_EMAIL_DOMAIN`) — small, mechanical, eliminates a confirmed drift bug.
   2. The `isCore` semantic divergence — confirm semantic first, then unify.
   3. `requireCore` + `requireCoreOrDomainLead` + `forbidden(request)` helpers — absorbs ~150 sites of route boilerplate and unifies response shapes.
   4. `<Button>` and `<Modal>` adoption — high-volume, visible, low-risk mechanical refactor.

---

## Appendix — files most worth opening first

Likely best-positioned places to land new shared helpers:

- `app/lib/auth.ts` — for `requireCore`, `requireCoreOrDomainLead`, `forbidden`, `unauthorized`
- `app/lib/display.ts` — for `fullName`, `primaryEmail`, `displayEmail`, `EMPTY_DISPLAY`
- `app/lib/app-env.ts` — for `getApiBaseUrl()`, `getFrontendUrl()`, `DARTMOUTH_EMAIL_DOMAIN`, `APPLICATIONS_FROM_EMAIL`
- `app/lib/roles.ts` — already hosts `currentTerm`, `getUserRoles`, `hasCycleAccess` — the missing helpers belong here too
- `app/lib/validate.ts` — for `parseForm(request, schema)`, an `idSchema` atom, `nullableTrimmed()`
- `app/components/ui/Button.tsx`, `app/components/Modal.tsx` — already exist, just need adoption
- A new `app/lib/csv.ts` — for the next export to share
- A new `app/lib/google-oauth.ts` — to consolidate the 5 token-refresh + 4 authorize-redirect copies
- `app/lib/timezone.ts` — already canonical; needs `app/hiring/lib/scheduling.ts:570` and friends to delete their copies
