# Drive Migration — Retire `/documents` + `/forms`, Remove the Flag

**Status:** planned · **Date:** 2026-08-16 · **Branch:** `feat/drive-migration`
(worktree `/Users/kiranjones/dali/dali-os-drive-migration`) · **Supersedes the
rollout tail of** `specs/drive-consolidation.md`.

## Goal

The unified Drive (`/drive`, `drive.hub.tsx` + `DriveBrowser` + `drive.server.ts`)
is live for everyone via the `drive-consolidation` flag (`defaultEveryone: true`).
Fully cut over: delete the old `/documents` hub and `/forms` browser, remove the
flag, collapse every branch to Drive-only, and retire the legacy `FormFolder`
schema — sequenced as two commits on one branch.

**Decisions (Kiran, 2026-08-16):**
- **Both layers, sequenced in one branch.** Layer A (UI + flag) lands first;
  Layer B (schema retirement) is a second commit whose destructive migration is
  gated on the `form-folder-mirror` job having run in prod.
- **Old hub URLs are removed entirely (404), not redirected.** Deep links
  (`/documents/:id`, `/documents/file/:id`, `/documents/:id/public`,
  `/documents/:id/export`, `/documents/agreement/*`, `/forms/edit/:id`,
  `/forms/responses/*`, `/forms/preview-resolve`, `/forms/fill/:token`,
  `/api/forms/fill/:token`) are **kept**.

## Architecture recap (what the audit found)

- The Drive hub is **fully self-contained** — its own `DriveBrowser` /
  `loadDriveScopes` / `drive.server.ts`. It does **not** reuse `UnifiedTree` or
  `FormsBrowser`. It navigates to `/documents/:id` (edit doc) and
  `/forms/edit/:id` (edit form) and POSTs to `/forms` (create-form) and
  `/admin/agreements` (create-agreement).
- The Drive reads forms/files/rubrics by **`folderPageId`** (a `Page` pointer),
  **not** `FormFolder`. Existing `FormFolder`-organized forms only appear nested
  in Drive after the `form-folder-mirror` backfill job sets their `folderPageId`
  (`app/jobs/form-folder-mirror.server.ts`, seeded **disabled**). Unplaced forms
  render at the Lab top level.
- Therefore "old support" is two layers: the **UI/flag** (Layer A, no data
  migration) and the **`FormFolder` schema** (Layer B, prod data migration).

---

## Commit 1 — Layer A: delete old surfaces + remove the flag

### 1A. Delete hub UIs
- **Delete** `app/routes/documents.hub.tsx` (hub UI + `loader`; `UnifiedTree`,
  `DocRow`, `FolderRow`, `ProjectFolderRow` all live inside it — no external
  importers).
- **Delete** `app/forms/routes/forms.tsx` (browser UI) — but **move its action
  first** (see 1B).
- **Delete** `app/forms/routes/forms.$folderId.tsx` (folder browser view).
- **Delete** `app/forms/components/FormsBrowser.tsx` (no importers after the two
  routes go).
- **Delete** `app/forms/lib/folder-tree.shared.ts` — **only if** its remaining
  importer `forms-data.ts:16` (`type FolderOption`) is also cut; that type feeds
  the folder-CRUD path removed in Layer B. **Keep in Layer A**, remove in Layer B
  (`folder-tree.test.ts` covers it).

### 1B. Preserve the create-form action as a resource route
`drive.hub.tsx:671` does `fetch("/forms", { intent: "create-form" })`. Since
`forms.tsx` is deleted:
- **New** `app/routes/api.forms.ts` — resource route, `action` only, delegating
  to `runFormsAction` (handles `create-form`). No `default`/`loader`.
- Register `route("api/forms", "routes/api.forms.ts")` in `routes.ts`.
- Update `drive.hub.tsx:671` fetch target `/forms` → `/api/forms`.

### 1C. `routes.ts`
- Remove `route("documents", "routes/documents.hub.tsx")` (line 152).
- Remove `route("forms", …)` (202) and `route("forms/:folderId", …)` (208).
- Add `route("api/forms", "routes/api.forms.ts")`.
- Keep every deep-link route listed under Decisions.

### 1D. Remove the flag + collapse every branch to the ON path
Delete the `drive-consolidation` entry from `app/lib/feature-flags.ts:95-101`,
then collapse each check site (keep the flag-ON branch, delete the OFF branch):

| File | Change |
|---|---|
| `app/lib/nav-areas.ts` | Delete `documents` + `forms` `NAV_AREAS` entries. Collapse `coreSubtabsFor` (~305), `pinnedNavItems` (~345 → Drive only), `visibleAreas` (~476 → always hide documents/forms, show drive). Drop the `flags["drive-consolidation"]` reads. |
| `app/components/CommandPalette.tsx` | Remove `driveOn` (168); always apply the Drive meta remap + section order; always filter the `documents` cluster (271). |
| `app/components/Layout.tsx` | Remove `useFeatureFlag("drive-consolidation")` (371) + the `flags` prop to CommandPalette (1044). |
| `app/components/LayoutClassic.tsx` | Same (92, 738); remove the old `/forms` sidebar link (268). |
| `app/admin/routes/admin.tsx` | Remove `isFeatureEnabled` check (35); always filter the `documents` cluster (64). |
| `app/signing/routes/admin.agreements.tsx` | Remove flag checks (78, 123); always `redirect("/drive?type=agreement")` on GET and `redirect("/documents/agreement/:id")` after create. |
| `app/signing/routes/admin.agreements.$id.tsx` | Remove flag checks (49, 135); always redirect to `/documents/agreement/:id`. |
| `app/signing/routes/documents.agreement.$id.tsx` / `.signature.$sigId.tsx` | Keep (canonical Drive surface). Optionally point the signature "Back to agreement" link straight at `/documents/agreement/:id`. |
| `app/projects/routes/projects.$id.tsx` | Remove `useFeatureFlag` (3407); always render the compact Drive-embed branch. **Breaks the partner-portal e2e that asserts the inline layout — update that spec.** |
| `app/lib/navbar-routes.ts`, `app/lib/analytics.ts` | Drop `/documents` + `/forms` hub-path entries. |
| `app/routes/help.getting-started.tsx` | Repoint the Forms/Documents tiles (105) → `/drive` (`?type=form` for forms). |
| `app/forms/routes/forms.edit.$formId.tsx`, `forms.responses.$formId.tsx` | Change `redirect("/forms")` fallbacks → `redirect("/drive")`; the responses breadcrumb link to `/forms/:folderId` → `/drive`. |

### 1E. Tests (Layer A)
- `app/lib/__tests__/nav-areas.test.ts:125-126,196,275` — drop the `LEGACY` /
  flag-off cases; update expectations to Drive-only.
- `e2e/drive.spec.ts`, `e2e/partner-portal.spec.ts` — update flag comments; fix
  the partner-portal `projects.$id` inline-layout assertion.
- Grep for any test importing the deleted routes/components.
- `npm run typecheck && npm test` green; `npm run build` passes.

---

## Commit 2 — Layer B: retire `FormFolder` / `Form.folderId`

**Precondition (gate the migration):** the `form-folder-mirror` job must have run
in **prod** so every `Form.folderId` has a corresponding `Form.folderPageId`.
Steps: flip `enabledByDefault: true` in `app/jobs/registry.ts:303` (or operator
Run-now), let it run in staging → prod, verify `count(Form where folderId != null
AND folderPageId == null) == 0` before merging the drop.

### 2A. Data + schema migration
- Backfill guard: ensure no orphaned `folderId`-only forms remain (mirror sets
  `folderPageId`).
- New Prisma migration: drop `Form.folderId` (+ FK) and the `FormFolder` table.
  **Data-losing → flag in the PR description** (CLAUDE.md); `migration-check` will
  surface it. Never hand-edit an applied migration.

### 2B. Code removals / rewires
- **Remove the mirror machinery:** `app/jobs/form-folder-mirror.server.ts`,
  `app/lib/form-folder-mirror.ts`, the `registry.ts` entry (303-316), and their
  tests (`form-folder-mirror.test.ts`).
- **`app/forms/lib/forms-data.ts`:** remove `loadFormsLevel`, `folderCrumbs`, the
  folder-CRUD intents (`create/rename/move/delete-folder`) and `move-form`'s
  `folderId` path from `runFormsAction`; drop the `FolderOption` import and delete
  `folder-tree.shared.ts` + `folder-tree.test.ts`.
- **`app/forms/routes/forms.edit.$formId.tsx` / `forms.responses.$formId.tsx`:**
  replace `folderCrumbs(form.folderId)` breadcrumbs with `folderPageId`-based
  Page-ancestry crumbs (or drop the crumb).
- **`app/lib/search.server.ts`:** remove `searchFormFolders` (276) + the
  `formFolder` `SearchResultType`; form-folder discovery is now Page-folder search
  (already covered by Page results). Update `search.ts`/`CommandPalette` `TYPE_META`
  accordingly.
- **MCP tools** (`app/mcp/tools/forms/`): `manage-forms-folder.ts` and
  `get-forms-folder.ts` become obsolete (folders are Pages → `create_page` /
  `manage_page`) — deregister from the MCP registry; repoint `list-forms.ts` to
  read forms by `folderPageId`; drop `folderId` from `manage-form.ts`. Update
  `forms-tools.test.ts`.

### 2C. Tests (Layer B)
- Remove/rewrite `forms-data.move.test.ts`, `forms-data.duplicate.test.ts`
  (folder-move assertions), `form-folder-mirror.test.ts`, `folder-tree.test.ts`,
  `forms-tools.test.ts`.
- `npm run typecheck && npm test`, `npm run build`, `migration-check` locally.

---

## Risks & CI gates
- `migration-check.yml` will flag the `FormFolder`/`folderId` drop — expected;
  document it. **Do not** merge Commit 2 until the mirror job is confirmed run in
  prod, else existing form placements orphan to the Lab top level.
- No CRDT/Yjs schema change here (form bodies untouched) — no collab caveat.
- `desktop` depends on `/api/notifications*`, `/auth/*`, `/link` — none touched.
- Partner-portal e2e depends on the old inline `projects.$id` doc layout — updated
  in Layer A.

## Verification
- Layer A: `/documents` and `/forms` 404; `/drive` is the only hub; sidebar + ⌘K
  show one Drive entry; create-form from Drive works via `/api/forms`; agreement
  authoring redirects to Drive; typecheck/tests/build green.
- Layer B: forms organize purely by `folderPageId`; no `FormFolder` references
  remain (`grep -r FormFolder app` clean); MCP folder tools gone; migration-check
  passes with the documented drop.
