# Forms vs other Drive items: review

Date: 2026-10-13. Branch `claude/forms-audit` (worktree `.claude/worktrees/forms-audit`), cut from `origin/staging` at 0948bb75.

Scope: how a Form compares with a document, notebook, whiteboard, or folder on four axes: data model, access, sharing, and the editing experience. Section 7 lists the divergences worth fixing, ordered. Section 8 is the question-type audit (separate agent).

All paths are under `dali-api/`.

## 1. Data model

| | Page (doc, notebook, whiteboard, folder) | Form |
|---|---|---|
| Table | `Page` (`prisma/schema.prisma:5182`), one row per item, `kind` discriminator | `Form` (`schema.prisma:4859`) plus `FormVersion`, `FormSubmission` |
| Where it lives | `workspaceType` + `workspaceId` + `parentPageId` | `folderPageId` only, a loose FK with no workspace. Null means "Lab top level" |
| Body | Yjs room, `contentDocId` | `draftQuestions` JSON on the row, frozen into `FormVersion.questions`; intro in `draftIntro` / `FormVersion.intro` |
| Identity extras | `iconEmoji`, `coverImageUrl`, `typography`, `lastEditedById`, `pinnedAt`, `notebookKey` | none. Fixed clipboard glyph, no emoji, no cover, no last editor |
| Access columns | `scopeKind`/`scopeGroupId`/`scopePermission`, `linkAccess`, `linkPermission`, `publicVisible`, `partnerVisible`, `shares[]` | `audience` (Members, SignedIn, Groups, Public) + `audienceGroupIds[]`, `listed`, `published` + `publicToken` |
| Relations to Drive features | `favorites[]`, `PageTag[]`, shortcuts (`targetPageId`), `UserFavorite.pageId` | none. `UserFavorite` has only `pageId` or `href` |
| Trash | `archivedAt` | `archivedAt` (parity) |

Consequence: every Drive feature that keys off `Page` (favorites, tags, shortcuts, shares, scope inheritance, Shared-with-me, Home recents, comments, backlinks, templates) silently excludes forms. Each gap below traces back to this.

## 2. Access

| Question | Page | Form |
|---|---|---|
| Who sees the row in Drive | `getPageAccess` per row: workspace role, governing folder scope, named shares, general access (`app/lib/pageAccess.server.ts:347`) | `canViewForms` (Core, Admin, or any Instructor; `app/lib/roles.ts:489`). All forms or none. The folder a form sits in never gates it (`app/lib/drive.server.ts:1274`) |
| Who can open/edit | `access.canEdit` | `isCore` only (`app/forms/routes/forms.edit.$formId.tsx:62`). Instructors fail the check and are redirected to `/` |
| Who can create, rename, move, delete | canEdit / canManageSharing per page | `canViewForms` (`app/routes/api.forms.ts:13`, `app/routes/api.drive.trash.ts:182`). So an Instructor can create, rename, move, and trash forms they are not allowed to open |
| Who can see responses | n/a (comments follow page access) | any Core user, every form. No owner, no collaborator list |
| Folder scope (Private / Lab / Group folders) | inherited by everything inside | ignored. A form inside a Group-scoped folder is visible to every `canViewForms` user and fillable per its own `audience` |
| Collab room auth | per page | `form:{id}:draft` is Core-only (`app/lib/collabAuth.ts:368`), consistent with the edit route |
| Search | `searchDocuments` filters `archivedAt: null` (`app/lib/search.server.ts:261`) | `searchForms` has no archived filter (`search.server.ts:359`), so trashed forms still match ⌘K |

Flags:

- **A. Gate mismatch.** `canViewForms` ⊃ `isCore`. The Drive list, the type filter pill, the New menu, search, trash, and `api.forms` all use the wider gate; the editor and collab room use the narrower one. For an Instructor, Drive shows "New form" and form rows that bounce to Home on click.
- **B. Placement is not access.** Docs and forms sit in the same folders, but only docs inherit the folder's scope. Nothing in the UI says so. A Core user who drops a form into a Private folder will assume it is private.
- **C. Two vocabularies for the same question.** Page: General access (Restricted / LabMembers / Public) + named shares with View/Comment/Edit/FullAccess. Form: audience (Members / SignedIn / Groups / Public) + listed. "SignedIn" and "LabMembers" overlap but are not the same set; "Groups" on a form is a flat id array, on a page it is a `PageShare` row per group with a permission. There is no way to let one named person fill or edit a form.

## 3. Sharing

| | Page | Form |
|---|---|---|
| Share entry point | Share dialog from Drive row menu, details pane, and the doc header. People + groups with permission tier, General access row, inherited-scope block, copy link | "Share" button in the editor only, disabled until published. Content is the fill link plus a QR code (`app/forms/components/FormDetail.tsx:828`). Who may fill lives under the gear icon (`FormSettings.tsx`), not under Share |
| Drive row menu | `share` entry for doc and folder (`app/components/drive/item-menu.ts:24`) | no share entry |
| "Who can see this" column and glyph tip | populated from `Audience` (`app/lib/page-audience.ts`) | the form `DriveItem` variant has no `audience` field (`drive.server.ts:186`), so the column is blank and the details pane shows only Where and Modified |
| Shared with me space | yes | no (forms are never named shares) |
| "Shared with you" notification | `notifyDocumentShared` | none |
| Partner visibility | doc and file | no |
| Public view | `documents.$pageId.public.tsx` behind `linkAccess` / `publicVisible` | `/forms/fill/:publicToken` behind `audience` |
| Scheduled open/close | no | yes (`opensAt` / `closesAt`, form-windows job). A feature forms have that docs lack |
| Managed forms | n/a | hiring, staffing, education, partner bindings lock distribution (`form-usages.server.ts`). Good, but the Drive row gives no hint that a form is managed beyond the linked-process pill |

Flag **D.** Share and Settings are split along the wrong seam. For a doc, "Share" answers "who can see or edit this". For a form, "Share" is a link-copy popover and the real audience is three clicks away under Settings. A user coming from the doc share dialog will look in the wrong place.

## 4. Drive integration, feature by feature

| Row feature | Doc / notebook | Folder | Form | Where it is decided |
|---|---|---|---|---|
| Open | ✓ | ✓ | ✓ (`/forms/edit/:id`) | `drive.server.ts:1050` |
| Favorite | ✓ | ✓ | ✗ | `item-menu.ts:23`, `DriveBrowser.tsx:2285` |
| Share | ✓ | ✓ | ✗ | `item-menu.ts:24` |
| Partner visibility | ✓ | | ✗ | `item-menu.ts:25` |
| Rename | ✓ | ✓ | ✓ | |
| Move | ✓ | ✓ | ✓ | |
| File in | ✓ | ✓ | ✗ | `file-in.ts:29` allows docs only, so the menu entry never appears for a form |
| Add shortcut (shortcut *to* this item) | ✓ | ✓ | ✗ | same gate; shortcuts are Pages pointing at Pages (`shortcut-api.ts:36`) |
| Trash / restore / purge | ✓ | ✓ | ✓ | parity |
| Tags | ✓ | ✓ | ✗ | `PageTag` is Page-keyed |
| Emoji / icon | ✓ | ✓ | ✗ fixed glyph | |
| Audience column | ✓ | ✓ | ✗ blank | |
| "Also in" (other scopes) | ✓ | ✓ | ✗ | |
| Quick Look | ✗ docs too | | ✗ | parity |
| Home / Recents | ✓ | | ✗ | `drive-home.server.ts` never touches `Form` |
| Shared with me | ✓ | | ✗ | |
| Templates (Drive ▸ Templates) | ✓ | | ✗ | `drive-templates.server.ts`. Hiring/education forms use `templateKey` instead, a parallel mechanism |
| Duplicate | server intent exists for both | | `duplicate-form` exists (`forms-data.ts:277`) but no Drive menu entry for any type | |
| Private (Member) space | ✓ | ✓ | ✗ "No forms or agreements live here" (`drive.server.ts:1289`) | no personal forms |
| Comments | ✓ | | ✗ | `api.comments.$pageId` |
| Linked-process pill | ✓ | | ✓ | parity |
| Orphan recovery | not needed | | special path (`loadOrphanForms`) because the FK is loose | symptom of the split model |

Cross-scope quirk: forms are loaded once, unscoped, and then placed into whichever scope's folder tree contains their folder (`drive-scopes.server.ts:224`). That works, but it means a form's "Where" is derived differently from every other row.

## 5. Editing experience

### Documents and notebooks
Open and type. Collaborative, autosaved, presence avatars, native ⌘Z, named versions with restore, comments, AI, find, table of contents, typography, icon and cover, inline title, move, favorite, and share all in one header. A notebook is the same editor with tabs. There is no Save and no Publish.

### Forms
`FormDetail.tsx` is a three-state machine:

1. **Draft**: questions live in a collab Y.Array room (`form:{id}:draft`); intro lives in local React state.
2. **Frozen version**: read-only view with Questions / Results toggle.
3. **Edit a version in place**: unlocked only while unused; runs with collab off (local state).

Plus explicit buttons: Save (draft), Publish (save-version + publish), Preview (round-trip to `/forms/preview-resolve`, opens a modal).

Specific divergences:

- **E. Half-collaborative.** The question list syncs through Yjs, but the intro `DocEditor` is plain `initialContent` + `onChange` (`FormBuilder.tsx:825`). Two authors editing at once see each other's questions but not each other's intro, and the last Save wins on the intro. Same for the inline edit buffer: each author's `editForm` state is local, so two people editing the same question write through each other.
- **F. Save model.** Docs: nothing to press. Forms: Save vs Publish vs Done (closes the inline editor, saves nothing), and a draft that is "NOT usable" until published. The green "Saved" flash lasts 2s. This is the clunkiness the user feels.
- **G. Not WYSIWYG.** A question row shows label, type badge, Required pill, and an "Accepts:" line (`FormBuilder.tsx:905`), never the control. Preview is a modal that needs a server round-trip. Docs are the preview.
- **H. Inline editor uses native controls.** Label, description, options (one per line), max words, custom accept are raw `<input>`, `<textarea>`, `<input type=number>` (`FormBuilder.tsx:506`, `635`, `658`). Options are a newline-separated textarea rather than a list. The CLAUDE.md convention is the shared `ui/` primitives.
- **I. Description is one plain line.** Per-question description is a single `<input>` (`FormBuilder.tsx:618`); the form intro is a rich `DocEditor`. Docs are rich everywhere.
- **J. Undo only with collab.** Undo/Redo buttons appear only when `formId && collabToken` (`FormBuilder.tsx:1004`). Editing a version in place has no undo at all.
- **K. Draft room never cleared.** `save-version` clears `draftQuestions` in Postgres (`forms-data.ts`), but nothing clears the Y.Array room. `useSharedArray` seeds from `initialItems` only when the room is empty (`useSharedCollection.ts:57`), so after a Publish the next "New version" connects to a room that still holds the just-published list. That is harmless when it matches, but "New version" seeded from an older version will be overridden by the room. Verify before relying on it.
- **L. Layout.** Component library on the left, canvas on the right, settings behind a gear, versions behind a clock, results behind a pill toggle inside the version view. Four places to look for state a doc shows in one header.
- **M. Fill page chrome.** `MemberFormShell` renders outside the app layout as a "branded card" (`MemberFormFillView.tsx:189`). Docs' public view uses the OS layout. Check against the single-aesthetic sweep.
- **N. Results.** Table of the newest 200 responses plus a detail modal and CSV (`VersionResults.tsx:58`). No per-question summary, no charts. Results are per version, so a form with three versions has three separate tables with no merged view.

### Parity that already exists (keep)
Inline title edit, drag-to-reorder (dnd-kit), page breaks, rich intro, `{{term}}` lint, reference questions resolved live, hiring/education/staffing bindings, QR code on the share link, scheduled windows, one-response and notify settings, and the version lock rule.

## 6. MCP and API surface
`app/mcp/tools/forms/` has list, manage, get-responses, submit. Docs have create/read/update page plus sharing, tags, trash, move, versions. Rough parity for the core; no MCP for form audience, publish state, or versions.

## 7. Divergences to fix, ordered

1. **Gate mismatch (A).** Decide one rule. Either `forms.edit` and `collabAuth` accept `canViewForms` so Instructors can edit, or Drive, search, `api.forms`, and trash narrow to `isCore`. Today the UI promises something the route refuses. Small change either way.
2. **Form rows carry an `audience`.** Derive an `Audience` for the form `DriveItem` from `audience`, `audienceGroupIds`, `published`, and `listed` ("Unpublished", "Lab members", "Group: Designers", "Public"). Fixes the blank column, the glyph tip, and the details pane in one place. Add a Published / Draft badge to the row.
3. **One Share surface.** Move audience and listed into the Share popover, laid out like the doc dialog: a General access row (audience) above the link. Keep schedule, one-response, and notify under Settings. Later, named people and groups as `PageShare`-style rows with a Fill permission.
4. **Make the builder fully collaborative or not at all (E, J, K).** Put the intro in its own room (`form:{id}:intro`, prose), move the inline edit buffer onto the Y.Map so field edits merge, and clear or reseed the draft room on `save-version`. Or drop collab from the builder and treat it like the challenge builder. Half is the worst state.
5. **WYSIWYG rows with a side panel (G, H, I, L).** Render each question as its real fill control (disabled), click to select, per-question settings in a right-hand panel built from `ui/` primitives (Select, Checkbox, Toggle, a chip list for options). Required toggle on the row. This retires the Preview round-trip for everything except reference questions.
6. **Fold `Form` into `Page` (kind `Form`).** The long-term fix for Section 4: favorites, tags, shortcuts, scope inheritance, Shared with me, Home, comments, templates, and partner visibility all come free, and the orphan path and the cross-scope placement hack go away. `FormVersion` and `FormSubmission` stay, keyed to the page id. This is a real migration (bindings in hiring, staffing, education, partner, notifications all hold `formId`) and the audience model has to be reconciled with page access (`audience` becomes general access plus named shares; `publicToken` becomes `linkAccess`). Needs a decision before any of 2 and 3 are built in a way that would have to be undone.
7. **Search excludes archived forms.** One `archivedAt: null` in `searchForms`.
8. **Home and Recents include forms.** Add forms to `drive-home.server.ts` recents and let `UserFavorite.href` star a form from Drive.
9. **Results summary view (N).** Per-question aggregates across versions where the question key is stable. Pairs with the new question types below (scales and choices want charts).
10. **Shortcuts to forms.** Not possible today because a shortcut is a Page pointing at a Page. Falls out of item 6; otherwise needs a `targetFormId` on `Page`.

Decision (Kiran, 2026-10-13): form becomes a Page kind, editing is doc-style, and access comes from page access rather than a role gate. That resolves (1), (6), and named sharing together. Section 9 is the plan; items 1 to 3, 7, 8, and 10 above fall out of it rather than being patched separately.

## 8. Question types: audit against established builders

Researched by a separate agent; the three bug claims marked ✔ were re-verified by hand.

### 8.1 What exists

`Question.type` (`app/types.ts:97`): `text`, `textarea`, `select`, `checkbox` (multi; Forms builder only, hidden from hiring via `allowCheckbox`), `skills_rating`, `reference`, `github_url`, `figma_url`, `drive_url`, `file`, `info`, `pageBreak`. Answers are strings except `checkbox` (string[]), `skills_rating` (a newline-joined `"Skill: N"` string), `reference` (row id).

Every place a new type must be taught, in order:

| Layer | File |
|---|---|
| Type union + `data` fields | `app/types.ts:99-151` |
| Allow-list (gates save-draft, save-version, preview, MCP) | `app/forms/lib/forms-data.ts:19-31` |
| Palette, `buildQuestion` (the only place `data` is assembled), per-type settings | `app/components/form-builder/FormBuilder.tsx:59-96, 154-203, 637-780` |
| Fill control | `app/components/form-builder/QuestionField.tsx:499-654` |
| Answered / required / paging | `app/lib/form-answers.ts`, `app/lib/form-pages.ts`, `app/lib/word-count.ts` |
| Server validation | `app/forms/lib/public-form.ts:154-291` (`validateAnswers`). Hiring does not call it |
| Merge tokens | `public-form.ts:57-76` interpolates label, description, options only |
| Results table, CSV, MCP `get_form_responses` | all share `app/forms/lib/answer-rows.server.ts:43-97`; objects fall to `JSON.stringify` |
| Hiring and education review | `app/hiring/components/ApplicationAnswers.tsx`, `ApplicationViewer.tsx`, `app/education/components/ApplicationAnswers.tsx` |
| Staffing column mapping | `app/projects/lib/slot-roles.ts:19-26` (declared, not enforced) |

### 8.2 Comparison

Sources: Google Forms question types and validation help pages, Fillout field types, Typeform question types, Tally input blocks, Microsoft Forms create-a-form, Jotform form fields overview.

| Type | Google | Fillout | Typeform | Tally | MS Forms | Jotform | DALI |
|---|---|---|---|---|---|---|---|
| Short text | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Long text | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Multiple choice (single, radio) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ dropdown only |
| Checkboxes (multi) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ Forms only |
| Dropdown | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Multi-select dropdown | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Linear / opinion scale | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Star rating | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Likert / choice grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (`skills_rating` is a fixed 0-5 grid) |
| Checkbox grid | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| NPS | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Number | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Email | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Phone | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| URL (generic) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | partial (GitHub, Figma, Drive only) |
| Date | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Time | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| File upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Yes / No | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Ranking | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Signature | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ (separate signing module) |
| Picture choice | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Section / page break | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Statement / info block | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ read-only, not authorable (bugs Q1, Q2) |
| Hidden / calculated field | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Live DB-backed picker | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ `reference` |

Non-type features:

| Feature | Google | Fillout | Typeform | Tally | MS | Jotform | DALI |
|---|---|---|---|---|---|---|---|
| Conditional logic | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Answer piping | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ (`{{term}}` only) |
| "Other" on choice | ✓ | ✓ | ✓ | via logic | ✓ | ✓ | ✗ |
| Randomize options | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Number min/max | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Length limit | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | partial: `maxWords` on long text, enforced server-side only for hiring |
| Default value / placeholder | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Checkbox min/max selections | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Regex validation | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |

DALI-only types: the three URL types are a generic URL field with a service placeholder and, in hiring, a non-blocking probe. `skills_rating` is a Likert grid with hard-coded 0-5 columns. `reference` is closest to Fillout's record picker and has no equivalent in the others.

### 8.3 Types to add, in order

Shared contract for any answered type: union, allow-list, palette + `buildQuestion` + settings, fill branch, `validateAnswers` rule, `isAnswered` rule, and a `formatAnswerValue` case if the stored shape is not string or string[]. Hiring surfaces need a case only if the type is offered to hiring builders.

Must-have:

1. **`radio`, multiple choice (single).** Reuse `options`. Stores a string, same as `select`, so staffing roles and CSV are unchanged. Fill with `ui/Radio` in a list (pattern exists in `ReferenceCardField`). Add server validation that the value is in `options` (today neither `select` nor this is checked).
2. **`scale`, linear scale.** `scaleMin` (0 or 1), `scaleMax` (2 to 10), optional end labels. NPS is 0 to 10 with labels, not a separate type. Stores a number; fill sends a string and the server coerces, like checkbox. Fill as a row of `Radio` with end labels. CSV cell is numeric. This covers the single-statement Likert case (session feedback, surveys).
3. **`grid`, Likert / choice grid.** `rows`, `columns`, `requireAllRows`. Stores `Record<row, column>`. Fill as a table of `Radio` groups collapsing to per-row `Select` on narrow widths (copy `SkillsRatingField`). Results cell renders "Row: Col; Row: Col"; CSV should emit one sub-column per row, which means extending `unionResponseColumns`. Merge tokens must interpolate rows and columns. Long term `skills_rating` becomes a preset of this; do not migrate existing data.
4. **`number`.** `min`, `max`, `integer`. Stores a number. No shared numeric primitive exists; use the base input classes.
5. **`date` and `time`.** `min`, `max`. Stores ISO date or `HH:mm`. Fill with `ui/DateField` (already supports date, datetime-local, time, min, max).

Nice-to-have: `email` and generic `url` as a `data.validation` rule on `text` rather than new types, folding the three URL types into `url` with a `urlService` hint later; `yesno` via `Toggle` (storage boolean, `isAnswered` must count false); multi-select dropdown as a `display` option on `checkbox` using the existing `ui/floating/MultiSelect`; checkbox min/max selections.

Skip: ranking (no use case, no shared sort primitive outside the builder), signature (would fork the signing module), payment, address, phone, picture choice, slider, hidden and calculated fields.

### 8.4 Bugs found in current type handling

- **Q1 ✔ Clicking an `info` row in the builder destroys its body.** `buildQuestion` (`FormBuilder.tsx:180-202`) never carries `data.body`, and the auto-commit effect rebuilds the row through it on first click. The type picker also has no `info` option and the badge falls back to the raw literal.
- **Q2 ✔ A form containing an `info` row cannot be saved.** `QUESTION_TYPES` (`forms-data.ts:19-31`) omits `info`, so `isQuestionArray` rejects the array: save-draft says "Could not parse questions.", save-version says "Add at least one valid question.", and MCP `manage_form` fails the same way. The seeded partner-application version carries an `info` row (`prisma/seed.ts:3503`). Either add `info` to the allow-list plus a palette tile (the body editor already exists in `info-body.tsx`) or stop rendering it.
- **Q3 ✔ `select` answers are never validated against `options`.** `validateAnswers` checks only checkbox, file, and reference. Hiring validates only required and word count.
- **Q4** Hiring applicant view (`hiring/components/ApplicationAnswers.tsx:103-118`) renders `pageBreak` and `info` rows as questions with a dash. Other surfaces filter one or both.
- **Q5** `maxWords` is enforced server-side only in `portal.apply.tsx`; Forms, Education, Partner, and MCP `submit_form` treat it as advisory.
- **Q6** `reference` answers show as raw ids in hiring review; only Forms results resolve labels.
- **Q7** Results table truncates `skills_rating` to its first line; the detail modal is fine.
- **Q8** `QuestionTypeConstraint` is declared but unenforced; `SlotColumnMapper` shows the raw type literal.
- **Q9** `allowCheckbox` is a one-off boolean. Any array- or object-valued type (grid, multi-select) needs the same hiring gate, so replace it with an `allowedTypes` set when adding types.

### 8.5 Non-type features, by effort

1. Placeholder and default value (trivial).
2. Length limit on short text, and call `validateWordLimits` inside `validateAnswers` to fix Q5 (small).
3. "Other" option on radio, select, and checkbox: free text stored as the value, validation allows one off-list value (medium).
4. Checkbox min/max selections (small).
5. Randomize option order (small, low value).
6. Answer piping as `{{answer:key}}` resolved on the fill page (medium; conflicts with server-side interpolation).
7. Conditional logic as a per-question `showIf` (show/hide, the Fillout and Tally model) rather than Google's go-to-section. Hidden questions are skipped by paging, required checks, validation, and results. Largest item; build after radio and scale land since they are the natural triggers.

## 9. Plan: Form as a Page

Decided 2026-10-13. Goal state: a form is a Drive page like a document or notebook. It is created, placed, found, favorited, tagged, shared, trashed, and opened the same way. Opening it shows the document chrome with a form builder where the prose body would be. Who can build it and see responses is page access. Who can fill it is a share setting on the same dialog, not a role gate.

### 9.1 Model

- Add `Form` to `PageKind`. A form is a `Page` row (kind `Form`) with the usual `workspaceType`, `workspaceId`, `parentPageId`, `title`, `iconEmoji`, `archivedAt`, `linkAccess`, `shares`, `favorites`, tags. Personal forms (workspace `Member`) and project or offering forms come free.
- Keep the `Form` table as a 1:1 extension keyed by the same id: `Form.id` = `Page.id`, with `page Page @relation(fields: [id], references: [id], onDelete: Cascade)`. Both tables already use cuid ids. This leaves every existing `formId` foreign key untouched: `ApplicationCycle` (two), `CycleDomainForm`, `Notification`, `EducationOffering`, `EducationFormBinding`, `FormVersion`, `FormSubmission`, `StaffingCycleFormBinding`, `PartnerApplicationFormBinding`. No backfill of those tables.
- `Form` keeps what is form-specific: `published`, `publicToken` (printed QR codes must keep working), `opensAt`, `closesAt`, `oneResponsePerMember`, `notifyOnSubmission`, `listed`, `templateKey`, `draftQuestions`, `draftIntro`, `createdById`.
- `Form` stops being read for: `name` (now `Page.title`), `folderPageId` (now `parentPageId`), `archivedAt` (now `Page.archivedAt`), `audience` and `audienceGroupIds` (now page access). Columns are dropped in the cleanup PR, not the migration PR.
- Add `SignedIn` to `LinkAccess` (Restricted, LabMembers, SignedIn, Public). It is the only form audience with no page equivalent, and it is a reasonable tier for docs too.

### 9.2 Access mapping

Page access already has the right shape. Fill is View, build is Edit.

| Today | After |
|---|---|
| `canViewForms` to see the row | `getPageAccess(...).canView`, same as any page |
| `isCore` to open the editor and see responses | `canEdit` |
| `audience = Public` | `linkAccess = Public` |
| `audience = Members` | `linkAccess = LabMembers` |
| `audience = SignedIn` | `linkAccess = SignedIn` (new) |
| `audience = Groups` + ids | `linkAccess = Restricted` plus one `PageShare` (Group, View) per id |
| no named people | `PageShare` (User, View) to fill, (User, Edit) to build and read responses |
| `listed` | unchanged, still "Forms for you" |
| managed forms (hiring, staffing, education, partner) | unchanged: `managingUsage` short-circuits the fill gate and the Share dialog shows "Managed by …" in place of General access |
| bound-form app lock (`gate.server.ts`) | calls the page check instead of `formFillAccess` |
| `form:{id}:draft` room auth (`sources.ts:170`, `collabAuth.ts:368`) | `canEdit` on the page, like `doc:` rooms |
| search (`searchForms`) | deleted; forms come through `searchDocuments` with the kind filter, archived filter included |
| MCP `list_forms`, `manage_form`, trash, move | page access |

Behavior changes to state in the PR: a form inside a scoped folder inherits that scope (a form in a Core folder becomes Core-only); Instructors stop seeing every form and instead see forms in their offering workspaces plus anything shared with them. Both are the point.

`canViewForms` survives only as the Groups-area gate; rename it `canViewGroups` in the cleanup PR.

### 9.3 Migration

One additive migration plus one idempotent data script, rehearsed on a throwaway DB first (`prisma migrate deploy` then run the SQL twice).

1. Schema: `PageKind.Form`, `LinkAccess.SignedIn`, the `Form.page` relation.
2. Data: for every `Form` row, insert a `Page` with the same id, `kind = 'Form'`, `title = name`, `archivedAt`, `linkAccess` per the table above, and `parentPageId = folderPageId` when that folder is live; `workspaceType`/`workspaceId` copied from the folder, else `Lab`/null. Orphaned forms land at the Lab root, which is what `loadOrphanForms` does today. Then one `PageShare` (Group, View) per `audienceGroupIds` entry. `ON CONFLICT DO NOTHING` on both inserts.
3. Seed: the 8 `prisma.form.upsert` calls in `prisma/seed.ts` and `seeds/accepted-applicants.ts` create the `Page` row too, through one `createForm()` helper the New menu also uses.

### 9.4 Drive and routing

- `DRIVE_PAGE_KINDS` and `HOME_PAGE_KINDS` include `Form`. `loadForms`, `loadOrphanForms`, `preloadedForms`, `needForms`, and the unscoped placement in `drive-scopes.server.ts` are deleted; forms load with the other pages and get `audience`, `tags`, `favorited`, `sharedBy` from the same code.
- Keep `type: "form"` on `DriveItem` (built from a page row, like `isWhiteboard`) so the glyph, type filter, and Trash keep working. `item-menu.ts`: `isPage` includes form.
- New form: `createLabPage` / `createProjectPage` with `kind: Form` plus the `Form` row, same name prompt as today.
- Open: `/documents/:id` branches on `kind === "Form"` next to the Whiteboard and Notebook branches (`documents.$pageId.tsx:165`). `/forms/edit/:id` redirects there. `/forms/fill/:token` stays and resolves token to page to `canView`.
- `api.forms.ts` folds into the page actions where an equivalent exists (rename, move, trash, duplicate); form-only intents (publish, window, settings, versions) stay.

### 9.5 Editor

Doc-style means: open and edit, autosaved, one header, native undo.

- **Chrome.** `DocumentEditor` today hardwires the BlockNote body. Give it a body render slot so a form page reuses the header (inline title, icon, favorite, share, tags, move, comments rail, presence) and the right rail. Comments on a form are "comments on the page", which is what authors want when reviewing a draft.
- **Autosave.** The form draft room's `syncBack` is a no-op today; "Save draft" is what writes `draftQuestions` (`sources.ts:160-168`). Implement structured sync-back (Y.Array to `draftQuestions`) on the Hocuspocus store hook, debounced like prose rooms. The intro moves into its own prose room `form:{id}:intro` with sync-back to `draftIntro`. The Save button goes away; the "draft" is simply the live page. Flag this in the PR as a collab schema change.
- **Versions.** Publish freezes the live room into a `FormVersion` (existing `save-version`) and sets `published`. The clock menu stays, styled like doc version history. Edit-version-in-place is dropped: fix a mistake by publishing again, which is what docs do. Unused-version delete stays.
- **WYSIWYG rows.** Each question renders its real fill control, disabled. Click selects a row; its settings open in the right rail, built from `ui/` primitives (Select for type, Toggle for required, a chip list for options, DateField for windows). Drag handle on the row, Enter adds a question below, Backspace on an empty row removes it, Y.UndoManager behind ⌘Z. Duplicate question in the row menu. Palette becomes a "+" menu between rows and a slash-style picker, not a permanent left column.
- **Preview** shrinks to "Open as respondent" (the fill page in a new tab), since the canvas is the preview. Reference questions still resolve live there.
- **Results** stay a header toggle, with the per-question summary from Section 7 item 9 when the new scale and choice types land.
- **Fill page** keeps `MemberFormShell` but on OS tokens, per the single-aesthetic sweep. Respondents never see the editor.
- The hiring challenge builder keeps the non-collab path until hiring forms are pages too; the WYSIWYG row and rail components are shared, the save model is not.

### 9.6 Sequencing

1. **Fix Q1 and Q2 now** (info rows lose their body, forms with info rows cannot save). Independent of everything else.
2. **PR A, model + Drive listing.** Schema, data migration, seed helper, forms listed as pages with audience and tags, type filter and Trash intact. Old editor still at `/forms/edit`, old gates still in force. Low risk, visible improvement.
3. **PR B, access cutover.** Edit route, fill route, bound-form gate, `api.forms`, trash, search, MCP, collab auth on page access. Share dialog form variant (General access labelled for filling, named shares View = fill, Edit = build). Audience radios removed from Settings. Behind flag `forms-page-access` so prod can flip after checking a few live forms.
4. **PR C, doc-style editor.** Body slot in `DocumentEditor`, structured sync-back, intro room, WYSIWYG rows and rail, Save removed, edit-in-place removed. Flag `form-editor-v2`.
5. **PR D, question types** (Section 8.3 order: radio, scale, grid, number, date/time) plus `allowedTypes` replacing `allowCheckbox`. Can run alongside C; it touches the type contract, not the chrome.
6. **PR E, cleanup.** Drop `Form.name`, `folderPageId`, `archivedAt`, `audience`, `audienceGroupIds`; delete `loadForms` and friends; rename `canViewForms` to `canViewGroups`; redirect cleanup.

### 9.7 Risks

- The data migration decides visibility for existing forms. Review the list of forms in scoped folders before merging PR A.
- Two new collab rooms per form (`draft` already exists, `intro` is new) and a sync-back path that writes JSON on every debounce. Bound the write and keep the Y.Array as the source of truth.
- `SignedIn` on `LinkAccess` widens what the doc share dialog can offer. Decide whether docs expose it or only forms do.
- Hiring, staffing, education, and partner all read `Form.name` and `folderPageId` somewhere in the 32 files that touch `prisma.form.`; PR A must swap those reads to the page before PR E drops the columns.
