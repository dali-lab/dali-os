# Destructive & Automation Guardrails — Confirms, Explanations, State-Clarity

Status: **Proposal (audit + phased build plan).** No code changes yet.
Branch (proposed): `feat/action-guardrails` (worktree off `origin/staging`).
Author intent (Kiran): "Some sites have automations/destructive actions that are
well explained and have a confirm modal — others are missing these entirely.
Audit the entire site for these missing features." Flagged examples: staffing
board "Create channel", and 26F term agreements still showing as issuable despite
already going out (unclear UI).

Decisions locked with Kiran up front:
- **Scope:** produce the plan; build only after approval (spec-first).
- This is the **guardrails** layer on top of the existing primitives — it does
  **not** introduce new UI infra. It reuses `useDialog()`/`useConfirmSubmit()`
  (`app/components/ui/dialog.tsx`) and the `Tooltip`/`InfoTip` primitive from the
  in-flight [`specs/tooltips.md`](./tooltips.md) sweep.

---

## 1. Executive summary

A full sweep of every action-bearing `.tsx` surface (hiring, projects/staffing,
admin/jobs, partners, education/forms, calendar, signing, mentorship, drive/docs,
members, settings) found the coverage is **lopsided, not absent**:

- **Destructive *deletes* are already well-guarded.** The `useDialog` convention
  landed broadly — delete project, delete epic, drive delete/purge, version
  restore, cross-workspace move, payroll delete, etc. all confirm properly. These
  are the templates to copy, not the problem.
- **The gap is the *automation / outward-send* side.** Actions that email people,
  expose data externally, or provision external systems (Slack/GitHub/Google) fire
  on one click with no preview, no confirm, and no "this already ran" signal.
- **A recurring inconsistency multiplies it:** the *same* action is guarded on one
  screen but not its sibling (e.g. Release is confirmed on the standard-cycle
  screen but not the internal-cycle one; Reject-partner is confirmed via the
  Accept button but not the status dropdown/board drag).

Kiran's two examples are the two failure modes, and every finding is one of them:

1. **Missing confirm on an outward automation** — e.g. staffing "Create + invite"
   invites the *entire term* to Slack with zero confirm/tooltip.
2. **Missing state-clarity** — e.g. agreements "Put in force" / "Issue term
   agreements" render identically whether or not the agreement already went out,
   so 26F keeps offering a live re-blast. (The confirm modal there is excellent;
   the bug is the control never says "already in force.")

Rough totals: **~21 HIGH, ~20 MEDIUM, ~15 LOW.** Most fixes are mechanical (wrap
in `useConfirmSubmit`/`dialog.confirm`, add a `Tooltip`). The two that need real
design work are the **state-clarity** items (agreements "in force" badge; partner
silent-decision paths) — those are logic, not just a modal.

---

## 2. The convention (what "guarded" means here)

Three tools, already in the codebase, applied by a simple rubric:

| Primitive | Use for | Import |
|---|---|---|
| `useConfirmSubmit()` | guarding a `<Form onSubmit>` (RR router/fetcher submits) | `~/components/ui/dialog` |
| `useDialog().confirm({ title, description, tone, confirmLabel })` | guarding an imperative `onClick`/fetch | `~/components/ui/dialog` |
| `Tooltip` / `InfoTip` | naming an icon-only control / explaining a side effect inline | `~/components/ui/floating` |

**Gold-standard pattern to copy:** `signing/components/IssueTermAgreementsButton.tsx`
— it fetches a preview, then confirms with the *exact recipients* and a `(re-issue)`
marker before sending. Any bulk outward send should look like this.

### Decision rubric (applied per action)

- **Confirm required** when the action is *irreversible* AND (*outward* — emails/
  Slack/notifies people, or exposes data externally) OR *bulk* (touches many rows/
  people at once). Use `tone: "destructive"` for deletes/reverts.
- **Preview-in-confirm required** (not just a yes/no) when it fans out to a
  variable set of people — show the count/names, like the gold standard.
- **Tooltip/InfoTip required** (may be *instead of* a confirm, for reversible
  actions) when the control is icon-only or its side effect isn't obvious from the
  label. **Disabled-hint tooltips do not count** — a `content={disabled ? "…" : null}`
  says nothing when the action is actually enabled.
- **State-clarity required** when an automation is idempotent/re-runnable — the
  control must show whether it *already ran* (badge, relabel, or disable), so an
  operator can't accidentally re-blast.

### Non-goals

- Not re-confirming trivially reversible actions (mark-read, reorder, toggle a
  local draft before Save).
- Not the general tooltip rollout — that's `specs/tooltips.md`. This spec only
  adds tooltips where a *dangerous/automation* action lacks any explanation.
- No new auth gates; no schema changes except where state-clarity needs a
  read-side flag (see §5 — none currently required, all derivable).

---

## 3. Phase P0 — HIGH severity (irreversible AND outward/bulk, one click, no confirm)

Each row is a checklist item. "Fix" = the concrete change.

### 3a. Bulk / outward SENDS with no confirm

- [ ] **Term "Create + invite" Slack channel** — `projects/components/StaffingBoard.tsx:1014`
  (`TermChannelBanner.run`). Creates term channel + invites all Core + all Admin +
  every project member. → Fetch a preview count and `dialog.confirm` before `run()`;
  add a `Tooltip` on the button. *(Kiran's example.)*
- [ ] **Send / Schedule announcement** — `admin/routes/admin.announcements.tsx:582`.
  Notification + email (+optional CC Dartmouth) + Slack DM to the whole lab. →
  `dialog.confirm` showing recipient count + channels (mirror gold standard).
- [ ] **Job "Run now"** — `admin/routes/admin.jobs.tsx:239`. Forces a tick; digest/
  reminder jobs email/Slack many immediately. → confirm: "Run <name> now? It may
  email/Slack members immediately."
- [ ] **Feature-flag "Everyone" + Save** — `admin/routes/admin.feature-flags.tsx:182,286`.
  Turns a feature on for every user. → confirm on Save *only when* `everyone` is
  newly true: "Enable <flag> for everyone (N users)?"
- [ ] **Release all finals** + **Release (single)** — internal cycle —
  `hiring/routes/lead.internal-cycle.$id.tsx:1364 / 1451`. Emails every
  accepted/rejected/waitlisted applicant. → add the `dialog.confirm` the
  *standard-cycle* screen already has (`lead.cycle.$id.tsx:2843 / 1181`).
- [ ] **Approve / Waitlist / Reject** (per-applicant) + **Approve all N** (education)
  — `education/components/ApplicationsReview.tsx:172` · `education.manage.$offeringId.tsx:1469`.
  Emails each applicant. → `confirmSubmit({ description: "Emails the applicant their decision." })`;
  bulk variant shows the count.
- [ ] **Reject** partner application (inline form) —
  `partners/routes/partners.applications.$id.tsx:1281`. Emails the external
  partner. → `confirmSubmit`, matching the Accept button already on that screen.
- [ ] **"Put in force"** agreement version — `signing/components/SigningDocumentDetail.tsx:619`.
  Binds version + emails a sign request to the entire audience. → `useConfirmSubmit`
  mirroring the AgreementsConsole twin (`AgreementsConsole.tsx:295`). *(See §5 for
  the paired state-clarity fix.)*

### 3b. External / public EXPOSURE with one click

- [ ] **General access → Public / Everyone-in-lab** — `components/sharing/ShareDialog.tsx:383`
  (onChange). "Public" = readable by anyone on the internet, no account; applied on
  dropdown select. → `dialog.confirm({ tone: "destructive" })` before posting the
  `general-access` change to Public (and to Lab for Member/Project docs).
- [ ] **Share with partner** (doc + file menu) — `projects/routes/projects.$id.tsx:4273`
  (docs), `:4992` (files). Exposes an internal doc/file to external partner accounts.
  → `dialog.confirm` naming who will see it; add a `Tooltip`. (Keep "Stop sharing"
  unconfirmed.)
- [ ] **Set → Published** (showcase) — `projects/routes/projects.$id.public-view.tsx:340`.
  Pushes the project to the public dali.website. → confirm before publish.

### 3c. Provisioning automation with no confirm step

- [ ] **Finalize** project — `projects/components/FinalizeModal.tsx:396`. The modal's
  checkboxes describe each step but clicking Finalize runs immediately: posts roster
  to Slack + creates GitHub team + creates Google group. → add a `dialog.confirm`
  summarizing the *selected* outward steps + roster size before `run()`.

### 3d. Destructive infra with no confirm

- [ ] **Disconnect Google calendar account** — `calendar/components/settings-cards.tsx:196`
  · `components/settings/CalendarSettingsBlock.tsx:102` · `CalendarsPanel.tsx:327`.
  Drops all synced events + availability + write destinations; icon-only. →
  `useConfirmSubmit({ tone: "destructive" })` + `Tooltip`.
- [ ] **Sign out others (N)** — `components/settings/SessionsSettingsBlock.tsx:27`.
  Bulk-revokes all other sessions (desktop app + MCP tools break). →
  `useConfirmSubmit` naming the consequence.
- [ ] **Delete page** (personal note) — `members/components/NoteShareModal.tsx:319`.
  Uses **native `window.confirm`** — the only survivor of the convention migration
  in this scope. → replace with `dialog.confirm({ tone: "destructive" })`.

---

## 4. Phase P1 / P2 — medium & low (condensed checklist)

### P1 (medium)

- [ ] **Hiring "Close Applications"** — `lead.cycle.$id.tsx:1639` — the one cycle
  transition with no confirm (its two siblings both have one). Add a confirm.
- [ ] **Hiring outward selects** — resend-invite / change-interview-location /
  reassign-interviewer (`lead.cycle.$id.tsx:2082/2141/2191` + `:2265/2323/2372`)
  email people but carry only disabled-hint tooltips. Add real explanation +
  confirm on the bare `<select onChange>` paths.
- [ ] **Hiring remove-reviewer / remove-interviewer** — `lead.cycle.$id.tsx:1378/1406`
  unguarded, while `domain-lead.tsx:1443/1656` confirm the same action. Reconcile.
- [ ] **Admin Grant/revoke Admin & Staff** — `admin/components/admin-shared.tsx:229/267`
  — security-sensitive, tooltip-only. Add confirm (esp. revoke).
- [ ] **Admin Add Core title** — `admin-shared.tsx:388` — pay-affecting + notifies
  admins. Add confirm.
- [ ] **Admin Disable email sender** — `admin/routes/admin.email-senders.tsx:276` —
  silent fallback to the Hiring sender. Add confirm noting the fallback.
- [ ] **Admin Add domain eligibility (P1/P2/P3)** — `admin.domains.tsx:411/417` —
  notifies the member; tooltip doesn't say so. Disclose.
- [ ] **Partners** invite-send / revoke-invite / meeting-invite-checkbox —
  `partners.$orgId.tsx:587/705`, `partner.settings.tsx:376/448`,
  `partners.applications.$id.tsx:1564` — outward emails, unguarded.
- [ ] **Calendar** delete Google sub-calendar + "remove class" —
  `calendar/components/composer.tsx:872/1058` — delete the Google event with only
  inline/no confirm. Add side-effect copy + destructive tone.
- [ ] **Projects "Archive Done & Cancelled"** — `components/TaskBoard.tsx:991` — bulk
  archive of every live Done/Cancelled task, no confirm. Add confirm with count.

### P2 (low)

- [ ] **Native-dialog survivors cleanup** (convention debt): `projects.$id.tsx:4503`
  (`window.prompt` rename), `:4537` (`window.confirm` delete) → `dialog.prompt` /
  `dialog.confirm`.
- [ ] **Settings** revoke-connected-app (`ConnectedAppsSettingsBlock`), disconnect
  Slack (`SlackSettingsBlock:40`), revoke single session (`SessionsSettingsBlock:82`)
  — add light confirm + visible tooltip (several are icon-only, aria-label only).
- [ ] **Members** remove-from-group (`members.groups.tsx:964`) tooltip; **Delete group**
  (`:806`) already confirms but the confirm has no `description` — add one naming
  the shares/scheduling audiences that break.
- [ ] **Projects** remove external mentor / SlotFormPicker bind / link-organization —
  light confirms / tooltips per §2 rubric.
- [ ] **Education** delete-assignment / delete-discussion-post — already confirm;
  add the "blocked once students submit" / "removes replies" disclosures.

---

## 5. State-clarity workstream (the "26F" class) — needs design, not just a modal

These controls are idempotent and re-runnable but give **no signal they already
ran**, so an operator re-fires an outward blast. This is Kiran's second example and
its own deliverable.

- [ ] **Agreements "Put in force" / "Issue term agreements"** — `SigningDocumentDetail.tsx:619`
  (+ version rows `:351`) and `AgreementsConsole.tsx`. Today the button renders for
  any published version regardless of whether a binding is already in force, and
  version rows never show an "In force" state. **Fix:**
  - Add an **"In force" badge** to the active version row (match `selectedVersion.id`
    against the current binding).
  - When the selected version is already in force, **relabel/disable** "Put in force"
    → "In force" (or "Re-send to unsigned" as an explicit secondary action).
  - In the console, **dim/annotate** agreements whose `needsActivation === false`
    ("Active — issued <term>") so 26F stops looking like it still needs sending.
  - Derivable from existing binding data — **no schema change expected.**
- [ ] **Partner silent-decision paths** — `partners.applications.$id.tsx:1745`
  (status dropdown) and `partners.applications.tsx:1129` (board drag). Reaching
  `Accepted`/`Rejected` via dropdown/drag transitions status **without** sending the
  email the button path sends — same end-state, opposite outward effect, no signal
  which. **Fix:** confirm on decision-state transitions from these paths, and
  surface "this does not email the partner — use Accept/Reject to notify."
- [ ] **Term "Create + invite" / Finalize** — no "channel already exists / team
  already provisioned / roster already posted" state. **Fix:** show a found-vs-created
  result that persists (not a transient string that clears on term change), so a
  duplicate outward blast is visibly unnecessary.

---

## 6. Suggested sequencing & effort

1. **P0 §3a–3d** — mostly mechanical wraps; one PR, grouped by area to keep diffs
   reviewable (hiring / admin / education / partners / signing / projects / settings).
   Reuse the gold-standard preview pattern for the fan-out sends.
2. **§5 state-clarity** — separate PR (real logic + a little design); agreements
   fix first (directly answers 26F), partner-decision fix second.
3. **P1** — follow-up PR.
4. **P2** — convention-debt cleanup, can ride along with tooltips.md work.

Verification: unit-test the new confirm gates where a helper is extracted; manual
verify the fan-out previews (recipient counts) against seeded data; confirm the
agreements "in force" badge renders for an already-issued term. No migrations
anticipated.

---

## 7. Positives (already gold-standard — do not touch)

`IssueTermAgreementsButton` (recipient preview before send), waitlist accept/remove,
onboarding reminders (recipient count in the confirm), `MoveToDialog` (explains the
exact access change), version restore, drive delete/purge, payroll delete,
cancel-meeting ("invitees will be notified"), AgreementsConsole activate/remind
(with 24h throttle + "already reminded Xh ago"). These prove the primitives are
sufficient — the work is coverage + consistency, not new infrastructure.

---

## 8. Open questions for Kiran

1. **Confirm depth for the fan-out sends:** full recipient *preview* (fetch +
   names, like the gold standard) everywhere, or a lighter count-only confirm for
   the less risky ones (e.g. education per-applicant)? Preview is more work per site.
2. **Agreements already-in-force UX:** disable "Put in force" entirely once active,
   or keep it as an explicit **"Re-send to unsigned only"** secondary action?
3. **Partner dropdown/drag decisions:** should reaching a decision state that way be
   *blocked* (force the Accept/Reject buttons so the email always fires), or allowed
   with a confirm that discloses "no email sent"?
4. **Priority order:** ship §5 (state-clarity, answers your two examples) *before*
   the broader P0 sweep, or bundle together?
