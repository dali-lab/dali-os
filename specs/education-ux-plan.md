# Education UX Plan

Scoped improvements to the existing Education LMS on the `worktree-education` branch. Four changes plus one prerequisite component fix.

---

## 0. Prerequisite: upgrade `Breadcrumbs.tsx` to per-match resolution

**Why this must go first:** The current `Breadcrumbs.tsx` resolves a dynamic label only for the **leaf** matched route (`matches[matches.length - 1]`). Intermediate dynamic segments — e.g., the offering CUID in `/education/manage/<cuid>/applications` — always fall through to raw `titleCase()` no matter what `handle.breadcrumb` the parent route exports. All of Section 2's breadcrumb work depends on this being fixed first.

**Change:** Rewrite the crumb-building loop in `Breadcrumbs.tsx` to walk `useMatches()` and call each match's `handle.breadcrumb(match.data)` to resolve its own segment, not just the last match. Concretely:

```ts
// Instead of resolving only the leaf label, build a parallel matches array
// so each match can contribute its own dynamic label.
const matches = useMatches() as { handle?: Handle; data?: unknown; pathname: string }[]

// For each path segment, find the deepest match whose pathname ends at that
// segment and has a handle.breadcrumb; use it to resolve the label.
```

The static `SEGMENT_LABELS` fallback stays for segments with no match or no handle.

Also add missing segment labels while here:

```ts
enrolled:      'My Learning',
offerings:     'Offerings',
manage:        'Manage',
sessions:      'Sessions',
assignments:   'Assignments',
announcements: 'Announcements',
discussions:   'Discussions',
grades:        'Grades',
templates:     'Templates',
```

---

## 1. Portal home hub

**Problem:** `/portal` goes straight to the application tracker. Education is a corner link. The applicant layout navbar link "Application" points to `/portal` (not `/portal/application`). Future features have nowhere to land.

**Fix:** Make `/portal` a sectioned dashboard. The existing application tracker content moves to `/portal/application`, displacing (and merging with) the current read-only submission view there. A new `/portal` renders the hub.

### Route changes

| Before | After |
|---|---|
| `/portal` → `routes/portal.tsx` (full tracker + domain cards) | `/portal` → new `routes/portal.home.tsx` (hub dashboard) |
| `/portal/application` → `routes/portal.application.tsx` (read-only submission view + withdraw) | `/portal/application` → `routes/portal.application.tsx` (**merge**: full tracker + domain cards + submission view + withdraw; these two surfaces combine) |

**`portal.application.tsx` collision resolution:** The current `/portal/application` is a read-only submitted-answers view with a withdraw action. After the change it becomes the full application tracker (domain cards, interview scheduling, deadlines) with the submission view inlined or accessible via a tab/section within the same page. The existing cross-links (`"View your submission →"` at portal.tsx line 1131, `WithdrawnView` at line 379) already point to `/portal/application` — they remain valid.

**Navbar update (`applicant-layout.tsx`):** The current nav links are `Application → /portal` and `Education → /portal/education`. After the change: `Home → /portal`, `Application → /portal/application`, `Education → /portal/education`.

### Post-cycle fallback behavior

The current `portal.tsx` intentionally falls back to the most recent cycle when no cycle is active, so accepted/rejected applicants still see their outcome after the cycle closes (lines 42-44, 62-80). **Preserve this behavior.** The Application section on the hub should not hide entirely when there is no active cycle — it should show the most recent outcome (accepted, rejected, waitlisted, etc.) with a muted "cycle closed" state. Only hide it if the user has never applied to any cycle.

### New `/portal` hub layout

```
Hi [firstName] —

─── Application ──────────────────────────────────────────
  [Active cycle] Cycle name · Open · Deadline Mar 15
  2 domains submitted                [View application →]

  [Post-cycle, has outcome] 26S · Closed · Accepted ✓
                                     [View application →]

  [Never applied, no active cycle — section hidden]

─── Education ────────────────────────────────────────────
  [Enrolled subsection — shown when user has ≥1 approved application]
  Intro to ML · Next session: Mon Jan 20      [Go to course →]

  [Open offerings]
  [Workshop]    Figma for Developers  · 6 spots remaining
  [Miniseries]  Intro to AR/VR        · Open

  [No open offerings] Nothing open right now — check back soon.

─── (future sections append here) ───────────────────────
```

### Hub loader

Three parallel queries (all already exist in the codebase):

1. **Cycle summary** — most recent active or recently-completed cycle: name, status, close date, `hasApplication`, `applicationStatus`, domain application count. Deliberately lightweight — no domain-card detail (that lives at `/portal/application`).
2. **Published offerings** — `listPublishedOfferings()` — for the Education open-offerings list.
3. **User's approved applications** — `listApplicationsForUser(userId)` filtered to `Approved` — for the enrolled subsection.

---

## 2. Enrolled view sub-nav (Canvas-style)

**Problem:** The enrolled view is one long scrollable page. Hard to navigate for offerings with many sessions and assignments.

**Fix:** Convert `/education/enrolled/:id` to a layout route with a left-rail sub-nav.

### New route structure

```
/education/enrolled/:id              → index redirects to /sessions
/education/enrolled/:id/sessions     → session list (current default content)
/education/enrolled/:id/assignments  → assignments + submissions
/education/enrolled/:id/announcements
/education/enrolled/:id/discussions
/education/enrolled/:id/grades       → per-assignment grade + feedback
```

The layout route renders the offering header + left-rail sub-nav + `<Outlet />`. Sub-routes render their content into the outlet.

```
┌─────────────────────────────────────────────────────┐
│  Intro to ML                              Instructor │
│  Mon Jan 13 – Feb 10 · Sudikoff 007                 │
├────────────┬────────────────────────────────────────┤
│ Sessions   │                                        │
│ Assignments│   [sub-route content here]             │
│ Announce.  │                                        │
│ Discussions│                                        │
│ Grades     │                                        │
└────────────┴────────────────────────────────────────┘
```

The left rail collapses to top tabs on narrow screens (same pattern as project workspace tabs).

### Correct `routes.ts` registration

React Router's `layout()` helper is pathless — it cannot own the `/education/enrolled/:id` URL. Use `route()` with nested children instead. Child paths are **relative** to the parent:

```ts
route("education/enrolled/:id", "education/routes/education.enrolled.$id.tsx", [
  index("education/routes/education.enrolled.$id.sessions.tsx"),
  route("assignments",   "education/routes/education.enrolled.$id.assignments.tsx"),
  route("announcements", "education/routes/education.enrolled.$id.announcements.tsx"),
  route("discussions",   "education/routes/education.enrolled.$id.discussions.tsx"),
  route("grades",        "education/routes/education.enrolled.$id.grades.tsx"),
]),
```

**Index vs. redirect:** Sessions is an `index` route — it renders at the bare `/education/enrolled/:id` URL with no redirect needed. Remove the `/sessions` path from the table above; the sessions content lives at `/education/enrolled/:id` (index), not `/education/enrolled/:id/sessions`. Breadcrumb labels should reflect this (sessions tab label = "Sessions" in the nav, but the URL is the index).

**Existing flat assignment-detail route:** `education/enrolled/:id/assignments/:assignmentId` (routes.ts line 104) is a separate flat route, not nested under the layout. It will NOT render inside the enrolled shell automatically. Two options: (a) keep it flat and accept that the assignment detail is a full-page view without the enrolled sub-nav (breadcrumb provides back navigation), or (b) nest it under the enrolled layout too. Either is fine but must be decided explicitly — the plan calls for option (a) and removing its manual back-link is acceptable since breadcrumbs cover it.

### Loader split + shared auth gate

The current enrolled loader does real gating (lines 18-35): requireAuth, canManageOffering preview path, and `application.status !== "Approved"` redirect. **React Router runs parent and child loaders in parallel** — a redirect in the layout route does not prevent child loaders from starting. Every sub-route loader must independently re-check auth.

Extract a shared helper `requireEnrollment(request, offeringId)`:
- Calls `requireAuth`
- Looks up the user's `EducationApplication` for this offering
- Returns `{ user, application, isManager }` or redirects

Each sub-route loader calls `requireEnrollment` first, then fetches only its tab-specific data.

The layout route loader fetches: offering metadata + enrollment status (for the header + sub-nav). Nothing else.

### Portal mirror routes

The portal mirror (`portal.education.$id.enrolled.tsx` and `portal.education.$id.assignments.$assignmentId.tsx`) get the same sub-nav treatment. They share the sub-nav component and the individual tab content components from the education routes — the content is identical; only the outer shell (portal top-bar vs member sidebar) differs. Apply the same nested route config pattern under the portal layout block.

### Manage view alignment

`/education/manage/:id` tabs (Settings / Sessions / Questions / Emails / Publish) are separate routes linked from the manage header — **not** a tabbed component. Applications and Assignments are further separate routes accessible via header links, not tabs. Update all of these to a left-rail visual style consistent with the enrolled sub-nav. This is a styling pass on the header links and the OfferingBuilder tab structure — no route changes needed for manage.

### Breadcrumb coupling with Section 0 and Section 3

`education.enrolled.$id.tsx` becomes a **layout** route after this section. That means it is no longer the leaf, so its `handle.breadcrumb` would be ignored by the old Breadcrumbs.tsx implementation. This is exactly why **Section 0 (per-match resolution) must land before the breadcrumb handles are added**. With Section 0 in place, the layout route's handle is resolved for its own segment, even though it is not the leaf.

---

## 3. Breadcrumb cleanup

**Depends on:** Section 0 (Breadcrumbs.tsx per-match upgrade) and Section 2 (enrolled route tree finalized).

### Add `handle.breadcrumb` to these routes

Once the route tree is final (Section 2), add handles so each dynamic segment shows the entity name rather than a raw CUID:

| Route file | `handle.breadcrumb(data)` returns |
|---|---|
| `education.offerings.$id.tsx` | `data.offering.title` |
| `education.enrolled.$id.tsx` (layout) | `data.offering.title` |
| `education.enrolled.$id.assignments.$assignmentId.tsx` | `data.assignment.title` |
| `education.manage.$id.tsx` | `data.offering.title` |
| `education.manage.$id.applications.tsx` | `"Applications"` |
| `education.manage.$id.assignments.tsx` | `"Assignments"` |
| `education.manage.assignments.$assignmentId.tsx` | `data.assignment.title` |
| `education.manage.sessions.$sessionId.attendance.tsx` | `"Attendance"` (session sequence in parent crumb) |
| `education.manage.templates.$id.tsx` | `data.template.name` |

Each route already returns the relevant entity from its loader — adding the handle is a one-liner per file.

### Remove duplicate manual back-links

These routes have both an automatic breadcrumb and a manual back-link. Remove the manual one:

- `education.manage.$id.applications.tsx` — remove `← Back to offering`
- `education.manage.$id.assignments.tsx` — remove `← Back to offering`
- `education.manage.sessions.$sessionId.attendance.tsx` — remove `← Back to offering`
- `education.manage.templates.tsx` — remove `← Back to manage`
- `education.enrolled.$id.assignments.$assignmentId.tsx` — remove `← Back to enrolled view`
- `routes/portal.education.$id.assignments.$assignmentId.tsx` — remove `← Back to enrolled view`

### Portal routes and breadcrumbs

`Breadcrumbs.tsx` is rendered only inside the member sidebar layout (`routes/layout.tsx` line 235) — it is not in `applicant-layout.tsx`. Removing back-links from portal routes without adding breadcrumbs would leave those pages with no in-page back navigation. Two options: (a) add `<Breadcrumbs />` to `applicant-layout.tsx`, or (b) keep one back-link on portal routes and only remove duplicates from member routes. **Decision required before implementing.** Default recommendation: add `<Breadcrumbs />` to `applicant-layout.tsx` (consistent with the member experience), but it requires the same `handle.breadcrumb` exports — those are already being added, so no extra work.

---

## 4. Application question types

**Problem:** Education application questions only support plain text. Instructors can't ask for portfolio links or work samples.

### Migration

**Do not hand-write the migration SQL.** Run `npx prisma migrate dev --name add_education_question_type` from `dali-api/` to generate it correctly. Prisma will emit a `CREATE TYPE "QuestionType" AS ENUM` + `ALTER TABLE` — hand-writing `ADD COLUMN "type" TEXT` would fail `migration-check.yml`'s schema drift check.

Prisma schema change:

```prisma
model EducationApplicationQuestion {
  id         String       @id @default(cuid())
  offeringId String
  prompt     String
  position   Int
  required   Boolean      @default(true)
  type       QuestionType @default(Text)   // ← new

  offering EducationOffering            @relation(fields: [offeringId], references: [id])
  answers  EducationApplicationAnswer[]

  @@index([offeringId, position])
}

enum QuestionType {
  Text
  Url
  File
}
```

`QuestionType` does not collide with any existing enum name (`SubmissionType`, `AttendanceStatus`, etc.).

### Full data-threading list

`type` must be carried through every layer — this is more than two component edits:

| File | Change needed |
|---|---|
| `education/lib/offerings-data.ts` | `type` must be included in question selects and upserts |
| `education/routes/api.offerings.$id.questions.ts` | Persist `type` from request body |
| `education/routes/education.manage.$id.tsx` (loader) | Map `type` into the questions array returned to the builder |
| `education/components/OfferingBuilder.tsx` | QuestionsTab state (`{ prompt, required }`) must add `type`; question create/edit form adds a type selector |
| `education/routes/education.offerings.$id.apply.tsx` (loader, line 45) | Thread `type` into questions prop |
| `education/routes/portal.education.$id.apply.tsx` (loader, line 41) | Same |
| `education/components/ApplicationForm.tsx` | Props add `type`; render branch per type |
| `education/routes/education.manage.$id.applications.tsx` | Thread `type` for reviewer display |

### `ApplicationForm` render by type

- `Text` → current `<textarea>` (unchanged)
- `Url` → `<input type="url" />` with client-side URL format validation; styled consistently with other form inputs
- `File` → file upload using the existing `/api/upload/presign` → S3 flow already used by `EducationSubmission` (not a new pattern)

### Reviewer display — do not directly reuse `AnswerDisplay`

`AnswerDisplay` from `hiring/components/ApplicationAnswers.tsx` operates on the hiring `Question` shape (`q.key`, `q.data.label`, hiring-specific url subtypes `github_url|figma_url|drive_url`). Education questions are shaped differently (`{ id, prompt, type }`). Direct reuse will silently fall through: a generic `Url` type has no branch in `AnswerDisplay` and renders as plain text, not a link.

Write a small adapter `educationAnswerDisplay(question, answerContent)` in `education/components/` that handles `Text | Url | File` correctly. File answers need S3 presigning — add a `presignAnswers` step in `education.manage.$id.applications.tsx`'s loader, same pattern as hiring's `presignAnswers`.

Note: `ApplicationsTable.tsx` currently renders answers inline (raw `<dd>`, lines 189-195) and does not use `AnswerDisplay` at all — update it to use the new adapter.

---

## Implementation order

1. **`Breadcrumbs.tsx` per-match upgrade + segment labels** (Section 0) — prerequisite for everything else; no schema, no routes, safe to ship independently.
2. **Enrolled sub-nav** (Section 2) — settle the route tree shape before adding breadcrumb handles.
3. **Breadcrumb handle exports + remove back-links** (Section 3) — now that route tree is final; decide on portal breadcrumb approach before removing portal back-links.
4. **Portal home hub** (Section 1) — independent of the above; slot here or earlier, after resolving the `portal.application.tsx` merge and the navbar change.
5. **Question types** (Section 4) — schema/migration last; budget for the full data-threading list and the reviewer-display adapter, not just two component edits.

---

## PR description checklist

When opening the PR:
- [ ] Note the `portal.application.tsx` merge (existing submission view + new tracker) as a behavior change
- [ ] Note the post-cycle Application section behavior (preserved — shows last outcome, not hidden)
- [ ] Note that enrolled sub-nav splits loaders: each tab loader re-checks enrollment (`requireEnrollment` helper)
- [ ] Note the `QuestionType` enum migration under "Data-losing / schema changes" (it is additive, not data-losing, but call it out)
- [ ] No collab-doc schema changes in this PR — existing `contentDocId`/`feedbackDocId` fields on assignments and submissions are untouched
- [ ] E2E: update `e2e/education.spec.ts` — the enrolled route restructure and new sub-routes will break the existing enrolled navigation smoke test
