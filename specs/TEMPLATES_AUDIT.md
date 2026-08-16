# Templates Audit — dali-os

_Branch: `templates-audit` (off `origin/staging`, 2026-08-15). Read-only analysis; no product code changed._

"Template" is an overloaded word in this repo. This audit separates the **distinct template systems**, rates each on maturity, and flags the real gaps — verified against the code, not just grep hits.

## The seven template concepts

| # | System | Storage | CRUD | UI to author | UI to instantiate | Maturity |
|---|--------|---------|------|--------------|-------------------|----------|
| 1 | **Email templates** | `EmailTemplate` + immutable `EmailTemplateVersion`; bound per-context via `CycleDecisionEmail` / `CycleNotificationEmail` / `EducationDecisionEmail` | Full | Admin + hiring routes, MCP | Cycle/offering picker dropdowns | **Production** |
| 2 | **Signing (agreement) templates** | `SigningDocument` + `SigningDocumentVersion` + `SigningBinding`; placeable fields + `{{term}}`/`{{today}}`/`{{memberName}}`/`{{supervisorName}}` | Full | `/admin/agreements` | `/sign/:bindingId`, cadence-driven | **Production** |
| 3 | **Mentor-note templates** | `MentorNoteTemplate` (single-default, ProseMirror `contentJson`) | Full (name/isDefault via MCP; body via DocEditor) | Mentorship `TemplatesModal` | Auto-seeded into new notes | **Production** |
| 4 | **Page/document templates (live)** | `Page.isTemplate` boolean; instantiation via `duplicatePage()` | Toggle flag | Editor "mark as template" + `manage_page` `set_template` | Drive/Docs "New → From template…" modal (`TemplatePicker`) | **Working, thin** |
| 5 | **Form "templates"** | Convention only — a `Form` with `draftQuestions` is treated as a template base; `duplicate-form` action | Duplicate | Forms editor | Duplicate button | **Convention, not a system** |
| 6 | **DocEditor presets** | `features.ts` capability sets (`field`/`notes`/`agreement`/`guide`/`document`) | n/a | code-level | n/a — toggles capabilities, **not** starter content | **By design, not content templates** |
| 7 | **Drive "Templates lens"** | `drive-templates.server.ts` aggregates 5 kinds into `TemplateItem[]` | — | — | **none** | **Orphaned / dead code** |

Systems 1–3 are mature and end-to-end. The gaps are concentrated in 4, 7, and the absence of workspace templates.

---

## Verified gaps (highest → lowest impact)

### G1 — The "Templates lens" loader is dead code
`app/lib/drive-templates.server.ts` (`loadTemplates`, aggregating page/form/mentorNote/email/signing into a unified gallery) has **zero callers** anywhere in `app/`. The drive-consolidation spec lists a "Templates gallery" as *landed Wave 4*, but `drive.hub.tsx` explicitly notes the shelves were removed and templates are "a creation aid in the New menu only." So the loader is built, role-gates five kinds correctly, and is wired to nothing.
- **Decision needed:** build the gallery UI that consumes it, or delete the loader. Right now it's a maintenance liability that reads as "done."

### G2 — Two disconnected page-template concepts; `PageTemplate` model is vestigial
- The **live** feature uses `Page.isTemplate = true` + `/api/page-templates` (queries `prisma.page` where `isTemplate`), instantiated by `duplicatePage()`.
- The **`PageTemplate` model** (name/description/`workspaceTypes`/`contentDocId`/`iconEmoji`/`isDefault`) is written **only by seed files** (`prisma/seed.ts:3882`, `seeds/v0-reference.ts:205`) and read **only by the dead loader** in G1. No product route creates, reads, or instantiates a `PageTemplate` row.
- **Gap:** a whole model + its seed data is unreachable from the app. Either migrate the live boolean-flag feature onto `PageTemplate` (richer: description, icon, workspace scoping, default) or drop the model. The current split guarantees confusion for the next person.

### G3 — No project / task / sprint / epic / checklist templates
Zero infrastructure in the project workspace. No `ProjectTemplate`, `TaskTemplate`, `SprintTemplate`, or reusable checklist. For a lab that re-runs similar projects and onboarding flows each term, this is the biggest **missing** template surface (as opposed to a half-built one). Not spec'd anywhere yet.

### G4 — Inconsistent merge-variable systems across template kinds
Three different variable vocabularies with no shared registry:
- Email: `{{firstName}}`, `{{domain}}`, `{{time}}`, `{{location}}`, `{{meetingUrl}}`, `{{originalCloseDate}}`, `{{newCloseDate}}` — validated per-slot in `hiring/lib/email-variables.ts`, soft-linted.
- Signing: `{{term}}`, `{{today}}`, `{{memberName}}`, `{{supervisorName}}` — resolved in `signing/lib/variables.server.ts`.
- Notification emails: no variables — `renderNotificationEmail()` is a hardcoded title/body/CTA shell.
- **Gap:** overlapping-but-different tokens (`{{today}}` vs `{{time}}`, `{{firstName}}` vs `{{memberName}}`), no single source of truth, so authors can't learn one syntax. A shared variable registry + linter would unify them.

### G5 — Education decision emails silently fall back to hardcoded copy
`education/lib/notifications.server.ts` uses a `STATUS_COPY` object (Approved/Waitlisted/Rejected) when no `EducationDecisionEmail` binding exists — whereas hiring surfaces the binding explicitly. The fallback is invisible in the offering UI (no preview, unlike the hiring cycle preview modal), so operators can't tell whether their applicants got a templated or a built-in message.

### G6 — Mentor-note template body is not authorable via MCP / has no first-class editor entry
`manage_mentor_note_template` can set name/`isDefault` but not `contentJson` ("body is collab-owned — edit via DocEditor"). The only path to edit the actual template body is opening it in a DocEditor surface. Minor, but it means a template can be created empty via MCP with no obvious way to fill it programmatically.

### G7 — `LegacyEmailTemplate` migration is incomplete
`LegacyEmailTemplate` (schema ~1360) is marked deprecated but per schema comments still backs `ApplicationReceived` and `InterviewInviteMentor`. The versioned `EmailTemplate` system is the go-forward, but two live email paths still read the legacy table. Finish the cutover or document why those two are pinned.

---

## What's genuinely solid (no action)
- Email + signing + mentor-note template CRUD, versioning, and binding are complete and consistent internally.
- `duplicatePage()` correctly byte-copies Y.Doc state, never carries `isTemplate` forward, and drops comments — the instantiation primitive is sound.
- Immutable-version + per-context-binding pattern (email & signing) is a good shared model; project/task templates (G3) should copy it rather than invent a new shape.

## Suggested next steps
1. **Decide G1/G2 together** — they're the same "Drive templates were half-designed" thread. Either land the gallery + migrate page templates onto `PageTemplate`, or delete `drive-templates.server.ts` + the `PageTemplate` model and keep the boolean-flag feature.
2. **Scope G3** (workspace templates) as a real feature using the versioned-binding pattern from email/signing.
3. **G4** — extract a shared merge-variable registry + linter; low-risk, high-clarity.
4. G5–G7 are cleanup/polish, do opportunistically.
