# DRY Refactor — Deferred Next Steps

Companion to [`DRY_AUDIT.md`](./DRY_AUDIT.md) and PR #834.

This file lists everything the DRY audit flagged that **did not ship** in PR #834. Each item is sized so it can be picked up as its own follow-up PR. Items are ordered by priority: do the semantic corrections first (they're real correctness work, not style), then the mechanical adoptions.

---

## Phase 6 — Semantic corrections (do these first)

These are correctness decisions already agreed on in the PR #834 review thread. They change behavior, so each gets its own PR.

### 6.1 — `isCore` env-admin override should be honored everywhere
**Decision:** Env admins ARE admins everywhere.

**Problem:** `app/lib/roles.ts:83 isCore()` honors `ADMIN_USER_IDS` env override, but five list-view loaders compute `isCore: u.coreAssignments.length > 0` directly from the array. Result: a user granted Admin only via env appears `isAdmin=false` in member lists but `isAdmin=true` in route gates.

**Sites to fix:**
- `app/admin-console/routes/api.members.ts:62`
- `app/admin-console/routes/admin-console.members.tsx:62`
- `app/admin-console/routes/admin-console.domains.tsx:80`
- `app/mcp/tools/search-directory.ts:108`
- `app/mcp/tools/get-member-profile.ts:92`

**Approach:** Compute `isCore`/`isAdmin` for each row by calling `getUserRoles(userId)` (the canonical helper at `roles.ts:32`) instead of deriving from the relation array. This is a small N+1 in the list views — acceptable for the page size, but if it bites, batch with a `getUserRolesBatch([userId])` helper.

**Risk:** Low. Existing tests pass; new test should assert that an env-admin user appears as admin in the member list.

---

### 6.2 — Retire `getCurrentTermId()`; standardize on `currentTerm()`
**Decision:** Roll-forward semantics win.

**Problem:** Two competing "current term" helpers with different inter-term-gap behavior. `roles.ts:186 currentTerm()` rolls forward to the next upcoming term in the gap; `groups.ts:90 getCurrentTermId()` returns `null` in that gap.

**Approach:**
1. Find every caller of `getCurrentTermId()` and convert to `(await currentTerm())?.id`.
2. Delete `getCurrentTermId()` from `groups.ts`.
3. The 3 hand-rolled copies in `app/hiring/lib/intern-eligibility.ts:11,35,58` have a comment saying they "deliberately do NOT fall back" — leave those alone, but add a sibling `currentTermStrict()` helper to `roles.ts` and have them call it so the math isn't open-coded.

**Risk:** Medium. Anywhere that branched on `null` in the inter-term gap will now get a term. Audit each call site for whether that change of behavior is acceptable (it usually is — UI surfaces want "what's coming up").

---

### 6.3 — Loosen project mutation APIs to match `projects.$id.tsx canEdit`
**Decision:** UI's `canEdit = core || isProjectMember` is correct; API gates should match.

**Problem:** The loader at `app/projects/routes/projects.$id.tsx:240` lets project members attempt edits the 14 mutation APIs then 403. Reconcile.

**Sites to update** (each currently gates on `isCore` only):
- `app/projects/routes/api.tasks.$id.ts:78`
- `app/projects/routes/api.epics.$id.ts:55`
- `app/projects/routes/api.stories.$id.ts:43`
- `app/projects/routes/api.sprints.$id.ts:49`
- `app/projects/routes/api.documents.$id.ts:32`
- `app/projects/routes/api.epics.$id.description-doc.ts:34`
- `app/projects/routes/api.projects.$id.tasks.ts:61`
- `app/projects/routes/api.projects.$id.epics.ts:59`
- `app/projects/routes/api.projects.$id.sprints.ts:48`
- `app/projects/routes/api.projects.$id.documents.ts:33`
- `app/projects/routes/api.epics.$id.stories.ts:44`
- `app/projects/routes/api.tasks.$id.move.ts:36`
- `app/projects/routes/api.files.$id.ts:97`
- `app/projects/routes/api.projects.$id.files.ts:35`

**Approach:**
1. Add a `requireProjectEditAccess(request, projectId)` helper to `app/lib/auth.ts` returning the same `{ok, auth} | {ok, response}` shape. Predicate: `isCore(userId) || isProjectMember(userId, projectId)`. Where to derive `projectId` per route varies (`params.id` is sometimes the task ID, sometimes the project ID — read each).
2. Replace `requireCore` with `requireProjectEditAccess` in the 14 routes.
3. Write tests: project member edit succeeds; outsider 403s; Core still works.

**Risk:** Medium-high — security-relevant. Confirm with a Core member that all 14 of these are intended to be project-member-editable. Some (e.g. `api.files.$id.ts` delete?) might actually be Core-only by policy.

---

## Phase 4 — UI primitive adoption (high-volume, mechanical, visible)

These are the largest mechanical migrations in the audit. They should happen across several PRs split by domain (a single PR touching 85 button sites is unreviewable).

### 4.1 — Adopt `<Button>` (PR per domain)
**Problem:** `bg-accent-coral text-white hover:bg-accent-coral/90` is hand-rolled 77 times. `app/components/ui/Button.tsx` has zero usages outside its own file.

**Split:** one PR per domain:
- Projects (~10 sites): `FinalizeModal.tsx:340`, `TaskModal.tsx:263,271`, `SlotColumnMapper.tsx:598`, `StaffingBoard.tsx:535`, `SlotFormPicker.tsx:79`, `TaskBoard.tsx:195`, `EpicSprintManager.tsx:848,951,1041`, `projects.list.tsx:190,285`, `projects.level-up.tsx:646,731`, `projects.$id.tsx:1043`
- Forms (~3): `MemberFormFillView.tsx:131`, `FormDetail.tsx:204,440`, `FormsBrowser.tsx:160`
- Calendar (~2): `calendar.tsx:1414,2017`
- Hiring (~1): `EmailTemplates.tsx:179`
- Misc components (~1): `ApplicantErrorBoundary.tsx:66`
- Plus the long tail (any new sites that landed since the audit)

**Approach:** For each site, swap the `<button className="bg-accent-coral …">` for `<Button variant="primary">`. The component already supports `size="sm"|"md"`, `disabled`, `type`, `onClick`. Watch for sites that mix in extra utility classes (e.g. `mt-2`, `w-full`) — pass via `className` prop on `<Button>` (cn() handles merging).

### 4.2 — Adopt `<Modal>` for hiring overlays
**Problem:** 8 hand-rolled `fixed inset-0 z-50 bg-black/40` overlays bypass `app/components/Modal.tsx` (which has correct focus-trap + Escape + scroll-lock).

**Sites:**
- `app/hiring/components/Library.tsx:193,325,466`
- `app/hiring/components/EmailTemplates.tsx:133`
- `app/hiring/components/delibs/ApplicantContextModal.tsx:67`
- `app/projects/routes/projects.level-up.tsx:691`
- `app/calendar/routes/calendar.tsx:1914`
- `app/forms/components/FormsBrowser.tsx:390`
- `app/components/collab/VersionHistoryPanel.tsx:151`

**Risk:** Low — `Modal.tsx` is the documented primitive, just adopt it. Watch for hand-rolled close buttons / X icons; reuse the Modal's built-in one.

### 4.3 — Consolidate Avatar / RolePills / STATUS_COLORS / DECISION_COLORS
**Problem:** Same UI elements re-implemented across `members.tsx`, `members.groups.tsx`, `MemberCard.tsx`, hiring routes. The DECISION_COLORS map at `domain-lead.application.$id.tsx:42` uses `bg-purple-100` for `InvitedToInterview` while every other site uses `bg-blue-100` — visible drift.

**Approach:**
1. Move `Avatar` and `RolePills` into `app/components/ui/` (alongside `Button` and `Card`); accept `size="sm"|"md"|"lg"` and an optional `showLevel` flag.
2. Move `STATUS_COLORS`, `DECISION_COLORS`, `STAGE_LABELS` into `app/hiring/lib/labels.ts`; have all 5+ sites import.
3. Fix the purple→blue drift while you're there (or document why purple was intentional).

---

## Phase 7 — Heavier rewrites

### 7.1 — Replace `validateReviewPatch` with Zod
**Problem:** `app/hiring/routes/api.reviews.$id.ts:39-160` is ~120 lines of imperative type-checking re-implementing what Zod does natively.

**Approach:**
```ts
const ReviewPatchSchema = z.object({
  scores: z.record(z.string().max(100), z.number().min(0).max(10))
            .superRefine((scores, ctx) => { /* per-rubric limits */ }),
  feedback: z.string().max(MAX_FEEDBACK),
  recommendation: z.enum(VALID_RECOMMENDATIONS),
  notes: z.string().max(MAX_NOTES).optional(),
  // ...
}).strict();
```

Then call `parseJson(request, ReviewPatchSchema)`. Also: deduplicate `VALID_RECOMMENDATIONS` (currently at both `api.reviews.$id.ts:8` AND `api.interviews.$id.complete.ts:10`) — extract to `hiring/lib/review.ts`.

**Risk:** Medium. Custom validator may have asymmetric rules vs Zod. Read carefully; consider keeping a few `.refine`s for cross-field invariants.

### 7.2 — Replace `coerceFormToAction` with `z.coerce` / `z.preprocess`
**Problem:** `app/calendar/routes/calendar.tsx:544-618` is 75 lines of hand-rolled FormData → typed object coercion.

**Approach:** Fold each branch into `CalendarActionSchema` itself using `z.coerce.number()`, `z.coerce.boolean()`, `z.preprocess((s) => JSON.parse(s), z.object({...}))`. After this, `parseForm(request, CalendarActionSchema)` (the new helper) replaces both `coerceFormToAction` AND the inline coercer in `routes/settings.calendar.tsx:82-94`.

**Risk:** Medium. Touch surface includes the calendar's main action handler. Test with both create-event and edit-event flows.

### 7.3 — Reconcile `getAppEnv()` vs `NODE_ENV === "production"`
**Problem:** Two parallel "what environment am I in?" axes. On Fly.io, staging is `NODE_ENV=production` — the two can disagree.

**Approach:**
- Decide: is `'dev' | 'staging' | 'prod'` the canonical axis, or is `NODE_ENV` plus a separate flag?
- Recommended: standardize on `getAppEnv()` for app-level branching (email staging banners, copy variants). Keep `NODE_ENV === "production"` only for things Node/security headers care about (cookie `Secure`, `x-frame-options`).
- Sites to migrate: `app/lib/cookies.ts:12`, `app/lib/security-headers.ts:1`, `app/routes/login.tsx:63,80`, `app/lib/dev-login.ts:2`. Pick one rule and document it in `CLAUDE.md`.

**Risk:** Medium. Cookie-secure / cookie-domain mistakes are silent in dev.

---

## Phase 3 — Adoption sites missed by PR #834

The hiring-domain agent stalled mid-run. These small follow-ups complete Phase 3.

### 3.1 — Hiring `idSchema` adoption
Three files still inline `z.string().min(1).max(100)`:
- `app/hiring/routes/api.my-interview.reschedule.ts:16` (and the action schema's `interviewId`/`newAvailabilityId` fields)
- `app/hiring/routes/api.interviews.$id.reassign.ts:13-14`
- `app/hiring/routes/api.domain-applications.$id.reviews.ts:10`

**Approach:** Replace each with `idSchema` imported from `~/lib/validate`. Bundle into a tiny PR.

### 3.2 — Hiring page-route `requireCoreOrDomainLead` adoption
Four route files still inline the gate:
- `app/hiring/routes/library.tsx:18-23, 68-73`
- `app/hiring/routes/rubrics.$id.tsx:16, 34`
- `app/hiring/routes/challenges.$id.tsx:16, 39`
- `app/hiring/routes/applications.tsx:37`

**Approach:** Adopt `requireCoreOrDomainLead(request)`. These are `.tsx` loaders, not API actions, so check whether they need to redirect (e.g. `/`) vs return a Response. Likely the existing pattern returns `Response.json(...)` even from loaders; if so, just swap.

### 3.3 — `displayEmail(user)` adoption (skipped sites)
Tighter `daliEmail ?? dartmouthEmail` chains that weren't migrated because they used a different fallback (`auth.user.email` vs `personalEmail`):
- `app/mcp/tools/rsvp-to-notification.ts:69`
- `app/routes/api.notifications.$id.rsvp.ts:63`
- `app/routes/oauth.consent.tsx:64`

**Approach:** Decide the canonical chain (almost certainly `primaryEmail(user) ?? auth.user.email`) and apply.

---

## Phase 5 — Remaining integration consolidation

### 5.1 — `lib/audit.ts` metadata schema discriminator
**Problem:** Each `AUDIT_ACTIONS` key has its own ad-hoc metadata shape. Today this is fine; future you will appreciate a discriminated union.

**Approach:**
```ts
type AuditMetadata =
  | { action: "staffing.assign"; cycleId: string; projectId: string; ... }
  | { action: "staffing.finalize"; cycleId: string; ... }
  | ...;
```
Type `logAuditEvent` so the `action` field constrains the `metadata` shape at compile time. Will surface drift between caller and reader.

**Risk:** Type-only. No runtime change.

### 5.2 — Slack response shape on "not configured"
**Problem:** 4 different shapes for "Slack isn't configured":
- `app/slack/lib/slack-client.ts:20-24` — throws
- `app/slack/lib/slack-client.ts:129` — silent null
- `app/projects/routes/api.staffing.finalize.ts:293` — `{ status: "skipped", message: "SLACK_BOT_TOKEN not set." }`
- `app/projects/routes/api.staffing.term-channel.ts:63` — `{ error: "SLACK_BOT_TOKEN not set." }, 400`

**Approach:** Standardize on the `{ status: "ok" | "skipped" | "error" }` discriminated-union shape that `google-workspace.ts` already uses. Wrap every Slack call in a `withSlackResult` helper that returns this shape; never throw.

### 5.3 — Retry helper extraction
**Problem:** `google-workspace.ts:252-281` has the only retry-with-backoff in the codebase, hand-rolled. The "staffing retry Google group adds" commit (#818) didn't factor it out.

**Approach:** Extract `retry(fn, { backoffsMs, untilOk })` into `lib/retry.ts`. Convert the `addGroupMember` retry to use it. Future Slack/GitHub retries can adopt.

---

## Phase 2 — Remaining exact-duplicate dedupe

### 2.1 — `forms/lib/forms-data.ts:safeParse` vs `public-form.ts:safeParse`
Two `safeParse(s)` helpers with subtly different null-handling. Pick one (the null-tolerant version) and have the other re-export.

### 2.2 — Three project routes' "user detail" page shells
`app/projects/routes/projects.project-bids.$userId.tsx`, `projects.intent-to-work.$userId.tsx`, `projects.level-up.$userId.tsx` all render `<dl className="bg-card border border-border rounded-lg divide-y divide-border">` with identical row shells. Extract `<UserSubmissionShell>` to `app/projects/components/`.

### 2.3 — Admin-console search-input + magnifier icon
`admin-console.announcements.tsx:374,427`, `admin-console.domains.tsx:281,459`, `admin-console.members.tsx:214` — 5 sites of `<Search className="absolute …" /> + <input className="w-full pl-7 …" />`. Extract `<SearchInput>` to `app/components/ui/`.

### 2.4 — Cancel button class
`px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50` at 6 sites. Should be `<Button variant="secondary">` (part of phase 4.1).

---

## Lower-priority hygiene

### H1 — `Level` type centralization
PR #834 added `lib/level.ts` with `Level` and `ALL_LEVELS`. Adoption is incomplete:
- `app/projects/lib/bid-validation.ts:18`
- `app/projects/lib/staffing-board.ts:5`
- `app/admin-console/lib/eligibility.ts:6-8`
- `app/admin-console/routes/admin-console.domains.tsx:313,326,331,391`
- `app/projects/routes/api.staffing.assign.ts:28,39` (hand-rolled validator can become `isLevel`)
- `app/projects/components/MemberCard.tsx:7-9`
- `app/projects/routes/projects.level-up.tsx:38-40,593`
Each should `import { Level, ALL_LEVELS, isLevel } from "~/lib/level"`.

### H2 — `Forbidden`/`Unauthorized` 403/401 plain-text holdouts
Sites returning `new Response("Forbidden", { status: 403 })` (plain text) that PR #834 left alone because they weren't JSON:
- `app/projects/routes/api.staffing.events.ts:23,25`
- `app/admin-console/routes/admin-console.payroll-export.csv.ts:31`
- `app/hiring/routes/lead.intern-to-full-cycle.$id.tsx:216`
- Several `tsx` action handlers in `projects.intent-to-work.tsx:177`, `projects.level-up.tsx:309,354`, `projects.project-bids.tsx:173`

Pick a canonical shape (`forbidden(request)` — JSON 403) and migrate, OR introduce a `forbiddenPlainText(request)` and adopt it.

### H3 — Page-template name strings (`prisma/seeds/v0-reference.ts:192-200`)
The template names (`Empty`, `Sprint Retro`, `Onboarding Doc`, etc.) live only in the seed file. If anything starts looking them up by string, extract to a shared `app/lib/page-templates.ts`. Not currently exploited; tracked for posterity.

### H4 — Sentinel `"Unknown"` vs `"—"` for missing fields
Two different sentinels coexist (`UNKNOWN_LABEL` and `EMPTY_DISPLAY` are both in `lib/display.ts` now). Decide policy:
- `EMPTY_DISPLAY` (`—`) for table cells / structured data
- `UNKNOWN_LABEL` (`Unknown`) for human prose ("Created by Unknown")

Document the choice in `lib/display.ts` as a 2-line comment and migrate the ~10 inline `"Unknown"` / `"—"` literals to match.

### H5 — Cycle-start season-digit math (`roles.ts:228-249`)
Bare magic numbers `9, 10, 1, 2` encode the (W=1, S=2, X=3, F=4) season ordering. Extract a `SEASON_SORT_INDEX` const to `lib/terms.shared.ts` and reference it from the math. Currently correct; just not readable.

### H6 — `getCurrentTermId` retirement (linked to 6.2)
After 6.2 ships, delete the function and any tests pointing at it.

---

## Tracking

For each item above:
1. Open a GitHub issue if there isn't one already.
2. Link the issue to this doc.
3. When the PR lands, strike through the entry here (or delete the section).

If priorities shift (e.g. you decide `<Button>` adoption is more urgent than the semantic corrections), re-order this file — the dependency graph is roughly:
- 6.x semantic items are independent of each other.
- 4.x UI adoption is independent of everything else.
- 7.x rewrites depend on nothing.
- 3.x / 5.x / H.x are smallest and can be parallelized.

Total estimated work: ~12 follow-up PRs, the largest being 4.1 (Button adoption).
