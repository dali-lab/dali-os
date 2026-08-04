# SelectMenu rollout — remaining native `<select>` conversions

`SelectMenu` (`dali-api/app/components/ui/SelectMenu.tsx`) is the app's custom
dropdown: the bespoke-popover look (portaled to `<body>` so it isn't clipped in
scrollable dialogs), per-option descriptions + checkmark, and a hidden native
`<select name>` for `<Form>` participation. It's a drop-in for `<select>` in
either mode:

- **Controlled / filter:** `value` + `onChange={(value) => ...}` (note: `onChange`
  gets the VALUE, not an event).
- **Form field:** `name` (+ `defaultValue`) renders a hidden native `<select>` so
  the value reaches `request.formData()`. `placeholder` shows when nothing is set.

## Done (do not redo)

- Reusable filters: `TermFilter`, `DomainFilter`, `SubmissionFilters`,
  `StaffingBoard` term, `members` domain, `TaskBoard` term, hiring `CycleSelector`,
  hiring `Library` domain.
- `ShareDialog` (permission tiers + general-access audience/role).
- Batch 1: `admin.attendance` sort, `admin.payroll-export` term,
  `PayrollBudgetPanel` project-type, `NotificationsSettingsBlock` email digest,
  `mentorship.browse` term + filters, `SlotFormPicker`, `SlotColumnMapper`,
  `AddExternalMentorModal`.

## Conversion rules (READ before touching a form select)

1. **Auto-submit-on-change is the trap.** If a select submits its form on change,
   do NOT re-submit the form's DOM (`submit(formRef)`) — the hidden `<select>`
   hasn't re-rendered with the just-picked value in that same tick, so the OLD
   value is submitted. Instead submit the **value** explicitly:
   - GET filter: `onChange={(value) => { const p = new URLSearchParams(searchParams); p.set("field", value); submit(p, { method: "get" }); }}` (`useSubmit`), or `navigate`/`setSearchParams`.
   - POST fetcher: `onChange={(value) => { const fd = new FormData(formRef.current!); fd.set("field", value); fetcher.submit(fd, { method: "post", action }); }}`.
2. **Preserve exactly:** option `value`s + labels, selected/`defaultValue`, `name`,
   `required`, `disabled`, per-option `disabled`, and sizing (old `className` →
   `buttonClassName`, keep width classes; add `inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`).
3. **Skip (native is better):** `<select multiple>`, and any select whose options
   are a huge dynamic list (> ~25, e.g. every member / all timezones / all audit
   actions) — a menu is worse UX there.
4. Verify each batch: `npm run typecheck`, `npm test`, `npm run build`, and review
   the diff for the auto-submit trap.

## Remaining (~30 files / ~85 selects) — grouped

Deferred because they're deep config forms (lower daily visibility, higher
submit-bug risk); each needs the rules above + ideally manual/e2e verification.

**Hiring**
- [ ] `app/hiring/routes/lead.cycle.$id.tsx` (~28 — the big one; split carefully)
- [ ] `app/hiring/routes/lead.intern-to-full-cycle.$id.tsx` (5)
- [ ] `app/hiring/routes/domain-lead.tsx` (5)
- [ ] `app/hiring/routes/applications.tsx` (3)
- [ ] `app/hiring/routes/onboarding.tsx` (2)
- [ ] `app/hiring/routes/lead.tsx` (1)
- [ ] `app/hiring/routes/interviews.$interviewId.tsx` (1)
- [ ] `app/hiring/routes/applications.$domainApplicationId.tsx` (1)

**Projects**
- [ ] `app/projects/components/TaskModal.tsx` (8 single-selects; the assignee
      `<select multiple>` stays native)
- [ ] `app/projects/components/EpicSprintManager.tsx` (8)
- [ ] `app/projects/routes/projects.$id.tsx` (3)
- [ ] `app/projects/components/MemberCard.tsx` (3)
- [ ] `app/projects/routes/projects.hub.tsx` (4)
- [ ] `app/projects/routes/projects.$id.public-view.tsx` (1)

**Education**
- [ ] `app/education/components/ManageCourseContent.tsx` (4)
- [ ] `app/education/routes/education.manage.$offeringId.tsx` (3)
- [ ] `app/education/components/RosterMatrix.tsx` (2)
- [ ] `app/education/components/OfferingFields.tsx` (1)

**Partners**
- [ ] `app/partners/routes/partners.applications.tsx` (4)
- [ ] `app/partners/routes/partners.applications.$id.tsx` (3)
- [ ] `app/partners/routes/partners.$orgId.tsx` (3)

**Signing**
- [ ] `app/signing/components/SigningDocumentsPage.tsx` (4)
- [ ] `app/signing/components/SigningDocumentDetail.tsx` (2)

**Members / Forms / Calendar**
- [ ] `app/members/components/MemberProfileView.tsx` (4)
- [ ] `app/members/components/NoteShareModal.tsx` (1 — group-add; note this modal
      is itself slated for consolidation into `ShareDialog`)
- [ ] `app/components/form-builder/QuestionField.tsx` (5)
- [ ] `app/components/form-builder/FormBuilder.tsx` (3)
- [ ] `app/forms/routes/forms.responses.$formId.tsx` (2)
- [ ] `app/calendar/routes/calendar.tsx` (12 — role/type selects; the time-of-day
      selects are large lists, likely keep native)

## Intentionally NOT converted (keep native)

- `app/admin/routes/admin.domains.tsx` — the select is an invisible overlay over a
  styled badge (bespoke UX; a menu would lose the badge).
- `app/admin/routes/admin.activity.tsx` — ~117 audit-action options.
- `app/routes/portal.settings.tsx` — 500+ timezones (`Intl.supportedValuesOf`).
- `TaskModal` assignee `<select multiple>` — multi-select.
