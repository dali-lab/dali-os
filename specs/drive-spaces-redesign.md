# Drive Spaces Redesign — Build Spec

Status: **proposed** (2026-08-18). Supersedes the later phases of `drive-consolidation.md`;
builds on the shipped cutover in `drive-migration.md` (PRs #1286 / #1289).

## 1. Problem

The Drive works, but three distinctions are illegible to users and fragile in code:

- **A. Core vs Hiring** — at the code level the split is clean (two `systemKey` scoped
  roots), but it's organized by *who administers a folder*, not *what process it serves*.
  So hiring's own artifacts are split across both roots: application/challenge **forms**
  live under **Hiring**, but **rubrics, email templates, agreements** live under **Core**.
  A hiring reviewer hunting the hiring rubric finds it under Core. The nav IA even
  disagrees with the Drive: `nav-areas.ts` puts Rubrics under **Hiring ▸ Library**, but
  `pages.ts` files them under **Core ▸ Rubrics**.
- **B. Auto-generated vs user-created** — every system container (`drive:core-root`,
  `drive:hiring-root`, per-project meeting-notes folders, public writeup) is keyed by
  `Page.systemKey` and is undeletable, but the finder renders them identically to a
  hand-made folder. No badge, no lock, no signal.
- **C. Hardcoded vs process-linked** — a form bound to Hiring 26F, a template that sends
  on acceptance, an agreement of a given kind: none of these links are shown. Placement is
  "organization only, never changes access" — a sound rule, never communicated.

Plus a **UI split**: some surfaces truly *embed* the finder (Hiring Library re-exports
`/drive`; project hubs embed it), while others are bespoke *wrappers* over Drive-backed
data — the flagship being **email templates**, which appear in Drive search as
`emailTemplate` items but can't be renamed/moved/deleted there and are really managed by a
separate card grid at `/core/communications/email`.

## 2. Decisions (locked)

1. **Drive's top level mirrors the nav areas.** The space list is generated from the same
   area registry the sidebar uses (`areasFor()` in `app/lib/nav-areas.ts`), so the Drive
   space selector *is* the nav selector by construction. This dissolves problem A: Core and
   Hiring stop being a bespoke split and become two of the app's areas, gated exactly like
   their sidebar entries.
2. **Unify all area-spaces into first-class ("real") spaces.** Stop the in-loader
   re-rooting/subtree gymnastics; every space is a declared entity loaded uniformly.
3. **Drive is the browser.** Drive uniformly owns list/rename/move/share/delete; opening an
   item launches its specialized editor (form builder, agreement signer). Bespoke card-grid
   *list* UIs are retired; their sidebar entries become deep-links into the Drive folder.
4. **Three signals, interleaved (no "System" divider):**
   - ① *system-managed container* → **hover** (reuse the `PageRow` reveal pattern), plus
     hide (don't grey) Delete/Rename. No lock glyph.
   - ② *process linkage on an item* → **always-on pill** that deep-links back to the process.
   - ③ *who can see a space/folder* → **hover** scope chip on the header.

## 3. Target model — the DriveSpace registry

New client-safe module `app/lib/drive-spaces.ts` (mirrors `nav-areas.ts`; **no** Prisma, so
its unit test needs no client — same rule as `feature-flags.ts`). One declared space per
document-owning nav area, each with a **backing strategy**:

| Space | Nav area | Backing strategy | Gate | Root identity |
|---|---|---|---|---|
| **My Drive** | (personal) | `member` — `workspaceType=Member`, `workspaceId=user` | always | none (top-level) |
| **General** | General | `lab-open` — `workspaceType=Lab`, top-level, unscoped | always | none (top-level) |
| **Projects** | General ▸ Projects | `workspace-multi` — one sub-space per `Project` workspace | project membership | per-project |
| **Education** | Education | `workspace-multi` — one sub-space per `EducationOffering` workspace | offering member / instructor / Core | per-offering |
| **Core** | Core | `lab-scoped-root` — `systemKey=drive:space:core`, `scopeKind=Group`→core group | `isCore` | the scoped root |
| **Hiring** | Hiring | `lab-scoped-root` — `systemKey=drive:space:hiring`, `scopeKind=Group`→hiring group | `hasHiringAccess` | the scoped root |
| **Partners** | General ▸ Partners | `virtual-filter` — Project pages where `partnerVisible=true` | Core / partner-linked | none (saved filter) — **deferred to Wave 4** |

Admin owns no documents → no space. People/Groups/Mentorship own no freeform docs → no
space (mentor notes keep their own surface).

**What "unify into real spaces" means concretely.** Storage stays `workspaceType` +
`systemKey` scoped roots — we deliberately do **not** migrate live Core/Hiring/Education
pages to a new `workspaceType` value (a disruptive enum + data migration for no user-visible
gain). The unification is *representational*: (a) each space is declared once in the registry
with `{key, label, icon, backing, gate}`; (b) `loadDriveScopes` iterates the registry instead
of hardcoding `My Drive / Lab / Core / Hiring / projects`; (c) each space is loaded by a
single predicate — no more "load Lab, subtract Core subtree, subtract Hiring subtree, then
re-root." The Education space becomes first-class (it's modeled today but never surfaced),
and Core/Hiring stop being computed by `subtreeIds()` carve-outs.

> If we later want a deeper storage unification (a dedicated `DriveSpace` table or a
> `workspaceType=Area`), the registry is the seam that makes it a backing-strategy swap
> rather than a caller rewrite. Out of scope here.

## 4. Data-model changes

Small — the heavy lifting is registry + loader + UI.

1. **Rename/rekey the scoped roots** for clarity and to formalize them as spaces:
   `drive:core-root` → `drive:space:core`, `drive:hiring-root` → `drive:space:hiring`.
   Idempotent-create already keys on `systemKey`; migration updates the two existing rows in
   place (no page moves). *(Optional — keeping the old keys also works; the rename is only
   for consistency with the registry. Flag in PR if we skip it.)*
2. **No new columns for reads.** Signal ② (process linkage) is *derived at load time* from
   existing relations — `Form → ApplicationCycle / CycleDomainForm`, `SigningDocument.kind`,
   `EmailTemplateVersion` bindings, `Rubric` usage. The loader attaches a
   `linkedProcess?: { label: string; href: string }` to each `DriveItem`. If profiling shows
   the derivation is hot, denormalize later; not now.
3. **Managed-folder systemKeys** for the coherent placement (Wave 3): ensure the per-area
   managed folders exist with stable keys — `drive:core:agreements:{kind}`,
   `drive:core:templates`, **`drive:hiring:rubrics`** (new; rubrics move here). Reuse the
   existing `ensureSystemChildFolder` helper in `pages.ts`.

`Page.scopeKind` / `scopeGroupId` / `scopePermission` and `systemKey` already exist
(`schema.prisma:3946–3962`, `:4052–4057`) and are already used by the Core/Hiring roots — we
generalize their use, we don't add them.

## 5. Loader rewrite — `app/lib/drive-scopes.server.ts`

Replace the hardcoded scope list + the `subtreeIds`/carve-out/re-root logic
(`drive-scopes.server.ts:34–195`) with a registry-driven loop:

```
for each space in visibleDriveSpaces(roleFlags, flags):
  switch space.backing:
    member          → loadDriveScope({ kind: "Member", workspaceId: user })
    lab-open        → loadDriveScope({ kind: "Lab", topLevelOnly, excludeScopedRoots })
    lab-scoped-root → ensure<Space>Root(); loadDriveScope scoped to that root
    workspace-multi → one sub-space per workspace the viewer can access
    virtual-filter  → deferred (Wave 4)
```

- **Form placement de-dup** collapses: with coherent Wave-3 placement, hiring/education/lab
  forms land in their own space's folders, so the current three-way "unplaced form leaks to
  Lab" special-casing (`drive-scopes.server.ts:219–248`) reduces to "a form belongs to the
  space whose folder its `folderPageId` resolves to; still-unplaced forms show in the
  creator's current space." Keep a single de-dup pass; delete the Core/Hiring subtraction.
- **`General` excludes the scoped roots** exactly as today (Core/Hiring roots are top-level
  Lab folders carved out of the General view). This stays; it's the one carve-out worth
  keeping because the roots physically live in the Lab workspace.
- Return type gains `space.gate`-derived metadata for signal ③ (`scopeKind`, resolved
  audience label) and per-item `linkedProcess` for signal ②.

## 6. Managed-artifact placement (nav-aligned) — the coherent rule

**Each managed-artifact type lives in the area the sidebar already assigns it**, adopted by
the existing best-effort `adopt*` passes in `pages.ts`:

| Artifact | Space (was → is) | Placed by | Sidebar deep-link |
|---|---|---|---|
| Agreements (by kind) | Core (unchanged) | `adoptAgreementsByKind`, `SigningDocument.kind` | Core ▸ Agreements → `/drive?space=core&folder=…` |
| Email templates | Core (unchanged) | `adoptEmailTemplatesByBinding` | Core ▸ Communications → Drive folder |
| **Rubrics** | **Core → Hiring** | new `drive:hiring:rubrics` folder | Hiring ▸ Library (already points at hiring Drive) |
| Forms (hiring cycle) | Hiring (unchanged) | `ensureHiringDriveRoot` adoption | — |
| Forms (education offering) | **→ that Education space** | new adoption by offering binding | Education ▸ Manage → Drive folder |
| Forms (general/lab) | General | unplaced → creator's space | — |
| Meeting notes, public writeup | their Project space (unchanged) | `ensureMeetingNotesFolder` etc. | project hub |

Invariant preserved and now surfaced: **placement is organization only — it never widens or
narrows access** (`drive-scopes.server.ts:64–77`). Access stays governed by the scoped-root
group + `getPageAccess`.

## 7. "Drive is the browser" — retarget the wrapper UIs

| Surface | Today | Change |
|---|---|---|
| **Email templates** | Card grid at `/core/communications/email` + `/admin/email-templates`; in `NON_MOVABLE`; can't rename/move/delete in Drive | Sidebar "Communications ▸ Email" deep-links to the Drive Templates folder. Retire the card-grid *list*; keep the per-template **editor** (`/admin/email-templates/:id`) as the "open" target. Drop `emailTemplate` from `NON_MOVABLE` within its managed folder. |
| **Agreements** | `/admin/agreements` renders a page then redirects to `/drive?type=agreement`; old page still exists | Delete the dead page + redirect; sidebar points straight at the Drive Agreements folder. Editor `/documents/agreement/:id` stays the "open" target. |
| **Rubrics** | Custom builder at `/hiring/rubrics/:id`, only reachable via Hiring Library | Keep the builder as the "open" target; rubrics now list in **Hiring ▸ Rubrics** with full Drive actions. |
| **Forms** | Created from Drive, edited at `/forms/edit/:formId` (bespoke builder), no way back | Keep the builder as "open"; add a breadcrumb back into its Drive folder (the loader already computes `driveFolderCrumbs`). |

Uniform rule: **list/organize/rename/move/share/delete happen in the finder; the
type-specific editor is what "open" launches** — the Google-Docs-from-Drive model. The
`DriveBrowser` "open" handler dispatches on `DriveItem.type` to the right editor route.

> Those editors span two eras today (the shared `DocEditor` vs. four single-user,
> manual-save, no-undo editors). "Drive is the browser" only feels coherent if opening a
> form/agreement/rubric doesn't whiplash after opening a doc — so §16 normalizes them
> (Tiers 1–3, including a shared collab substrate).

## 8. The three signals

Anchor components: `app/components/drive/DriveBrowser.tsx` (rows), the space/column header,
and the reveal convention from `app/routes/home.tsx:786–813`.

### ① System-managed container — hover chip + hidden destructive actions
- Reveal a small **"Managed"** text chip (not a lock icon — GitLab replaced its ambiguous
  lock glyph with the word "PROTECTED"; text wins when the *kind* of restriction matters)
  on any row whose `Page.systemKey` is set, using the established pattern:
  `opacity-0 group-hover:opacity-100 focus-within:opacity-100` on the chip inside a `group`
  row container.
- **Hide** Delete/Rename for `systemKey` rows entirely (they're structural) rather than
  grey them out — Nielsen's rule: hide what a user can *never* do. Extend the same gate the
  Move menu already uses (`DriveBrowser.tsx:258–260`) to Delete/Rename.

### ② Process linkage — always-on pill
- A `<ProcessLinkPill>` (neutral/gray, Atlassian-lozenge style) rendered inline on every row
  whose loader-derived `linkedProcess` is set: e.g. "Hiring 26F", "Confidentiality",
  "Sends on acceptance". Clicking it navigates to the owning process page (round-trip).
- Always visible — it's the one signal that changes what an item *is*, and it's the single
  thing every comparable tool (Asana/ClickUp/monday/Linear) drops and users keep asking for.
- Derived read-side now; model provenance as first-class data only if profiling demands.

### ③ Space/folder audience — hover scope chip
- On the space header (and any scoped Folder), reveal a **scope chip** on hover: "Core only"
  / "Hiring team" / "Everyone in the lab" / "Private", derived from `scopeKind` +
  resolved group audience. Notion labels teamspaces Open/Closed/Private the same way. Text,
  hover, same `group-hover` mechanism.

## 9. Access & permissions

No change to the access model. `getPageAccess` + scoped-root group membership remain
authoritative; placement never affects access (§6). Signal ③ *reads* the scope to display
it; it never writes. The `labCanViewForms` widening for hiring-team-but-not-Core members
(`drive-scopes.server.ts:112`) is preserved by the per-space loader (Hiring space loads its
own forms for hiring-team viewers).

## 10. Migration & data safety

1. **Rubric re-home** (data-moving, prod-gated): move existing rubric folder pages from
   `Core ▸ Rubrics` to `Hiring ▸ Rubrics` (`Rubric.folderPageId` repoint). Idempotent;
   guarded like the hiring-root re-home in `drive-migration.md`. **Flag in PR description**
   (moves rows the hiring team can now see and Core can still see — no access change, but
   call it out).
2. **Root rekey** (§4.1) — in-place `systemKey` update, no page moves. Optional.
3. **Education/forms adoption** — additive; new `adopt*` pass files education-bound forms
   into their offering space on next Drive load. Best-effort, idempotent (matches existing
   adoption pattern; no backfill job needed).
4. Standard migration rules apply (`prisma/MIGRATIONS.md`): new migration only, never edit
   applied files; `DIRECT_URL` for `migrate deploy`; `migration-check.yml` must pass.

## 11. Feature flag

Gate the whole redesign behind **`drive-spaces`** (add to `app/lib/feature-flags.ts`,
default off, Core-targetable — see `project_feature_flags`). The registry reads
`areasFor(flags)` so it composes with `nav-regroup`. With the flag off, `loadDriveScopes`
keeps today's behavior verbatim. Flip on for Core first, then everyone.

## 12. Phasing (each wave independently shippable)

- **Wave 0 — Registry (no behavior change).** Add `app/lib/drive-spaces.ts` + its unit test;
  add `linkedProcess`/scope metadata to the `DriveItem`/`DriveTreeScope` types (unpopulated).
- **Wave 1 — Loader rewrite (flagged).** Registry-driven `loadDriveScopes`; surface the
  Education space; formalize Core/Hiring; delete the subtree carve-outs. Behavior identical
  with flag off; new space list with flag on.
- **Wave 2 — Signals.** ② linkage pill (always-on) → ① managed chip + hidden destructive
  actions → ③ scope chip (hover). Ship ② first (highest value, no placement dependency).
- **Wave 3 — Browser-canonical + placement coherence.** Retarget email/agreements/rubrics/
  forms sidebar entries to Drive deep-links; retire card-grid lists; rubric re-home
  migration; education-form adoption. Plus **Tier 1 editor polish** (§16.2) — cheap
  token/kit/error/breadcrumb normalization on every "open" target.
- **Wave 4 — Cleanup.** Delete dead `admin.agreements` page + redirect; Move/Delete tooltips
  where still gated; optional Partners virtual space.
- **Wave 5 — Editor shell + Agreement collab** (§16.3–16.4 prose track). Shared managed-editor
  shell (rename / save-state / version sidebar / **restore** / unsaved guard); Agreement body
  → collab room. Proves the pattern on prose; near-zero new substrate.
- **Wave 6 — Structured collab infra + Forms** (§16.4 structured track). Build the reusable
  `useSharedArray/Map` hook + `readDocAsJson` server read + structured sync-back; move the form
  builder's working question list onto a structured room. Highest-risk wave, isolated.
- **Wave 7 — Rubric collab + parity cleanup** (§16.4). Rubric criteria onto the Wave-6 hook
  (this is where the real drag-reorder lands); email test-send/preview (§16.4, non-substrate);
  final editor-parity sweep.

## 13. Testing & CI

- **Unit (Vitest):** `drive-spaces.ts` registry (client-safe, no Prisma); loader partition
  per backing strategy; `linkedProcess` derivation per artifact type; scope-chip audience
  resolution.
- **E2E (Playwright, seeded Postgres):** space selector mirrors the sidebar areas for a Core
  viewer vs a regular member; Education space visible to an enrolled student; rubric appears
  under Hiring not Core; email-template row supports rename/move/delete; managed folder hides
  Delete; linkage pill navigates to the process. Watch the client-bundle-leak test — keep all
  server-only logic in `*.server.ts` (see `reference_client_bundle_node_crypto_gotcha`).
- **Editor collab (§16.4):** two-client convergence per room (agreement body edit; form
  question reorder; rubric criterion edit); **snapshot round-trip** (edit room → Save Version →
  Postgres column matches → reload seeds room from that version); native `Y.UndoManager` undo on
  a structured room; per-entity room authorization (a non-member is refused the `form:`/
  `signing:`/`rubric:` room); Tier-1 error-surfacing (agreement/email action `{error}` now
  visible). Flag any change to a room's structured shape in the PR (CRDT caveat, §16.6).
- Gating checks: `test.yml`, `migration-check.yml` (rubric re-home), `build-check.yml`,
  `codeql.yml`.

## 14. Files touched (map)

- `app/lib/drive-spaces.ts` *(new)* — registry, backing strategies, `visibleDriveSpaces`.
- `app/lib/nav-areas.ts` — export the area→space mapping seam.
- `app/lib/drive-scopes.server.ts` — registry-driven rewrite; delete carve-outs; attach
  signal metadata.
- `app/lib/drive.server.ts` — `DriveItem.linkedProcess`; `open`-target dispatch per type.
- `app/lib/pages.ts` — `ensureEducationSpace*` adoption; `drive:hiring:rubrics`; root rekey;
  extend `adopt*`.
- `app/components/drive/DriveBrowser.tsx` — three signal renders; hide Delete/Rename for
  `systemKey`; open-dispatch.
- `app/components/drive/ProcessLinkPill.tsx` *(new)*, scope-chip + managed-chip (reuse
  `home.tsx` PageRow reveal).
- `app/lib/feature-flags.ts` — `drive-spaces` flag.
- Sidebar deep-link retargets: email templates (`admin.email-templates.tsx` /
  `core.communications.email.tsx`), `signing/routes/admin.agreements.tsx` (delete redirect),
  Hiring Library rubric listing.
- `prisma/migrations/…` *(new)* — rubric re-home + optional root rekey.

**Editor consistency & collab (§16):**
- `app/components/editor/ManagedEditorShell.tsx` *(new)* — shared chrome for the non-doc
  editors (rename, save-state, version sidebar, restore, unsaved guard).
- `app/collab/useSharedString.ts` → add `useSharedArray` / `useSharedMap` *(new hooks)* —
  structured Yjs binding with native `Y.UndoManager`.
- `app/collab/read.ts` — `readDocAsJson` / `getStructuredData` (parallel to `readDocAsBlocks`).
- `app/collab/persistence.ts` — structured serializer path in `storeDocument` (don't call
  `getPlainText` for Map rooms); `app/collab/collabAuth.ts` + `app/collab/sources.ts` —
  `signing` / `form` / `rubric` authorize branches + `COLLAB_SOURCES` entries;
  `app/collab/roomName.ts` — new room names.
- `app/signing/components/SigningDocumentDetail.tsx` — `DocEditor` collab prop + seed-from-
  version / snapshot-on-save; Tier-1 token/kit swaps; wire `useActionData`.
- `app/components/form-builder/FormBuilder.tsx` + `app/forms/lib/forms-data.ts` — bind working
  questions to the shared hook; snapshot on Save (draft/version); Tier-1 kit/token swaps.
- `app/hiring/components/RubricDetail.tsx` + `app/hiring/routes/rubrics.$id.tsx` — shared hook,
  real drag-reorder, edit-in-place; delete dead `RubricsContext.tsx`.
- `app/admin/components/EmailTemplateDetail.tsx` — Tier-1 token/kit/breadcrumb/error fixes;
  test-send + rendered preview (Wave 7, non-substrate).
- Tier-1 token normalization across `VersionHistoryPanel` + the four editors (kill `blue-*`).

## 15. Open questions

- **Root rekey (§4.1):** worth the migration for naming consistency, or leave
  `drive:core-root`/`drive:hiring-root` as-is? (Lean: rekey — it's cheap and the registry
  reads cleaner.)
- **Partners space:** ship the virtual-filter view in Wave 4, or leave partner docs living
  only inside their Project spaces? (Lean: defer — it's a cross-cut of Projects, low marginal
  value for internal members.)
- **Education forms:** confirm education offerings actually attach forms we want filed into
  the Education space (vs. staying general) before writing that adoption pass.
- **Offline for structured rooms:** verify `y-indexeddb` behaves for `Y.Array`/`Y.Map` rooms
  (it's Y.Doc-level, so it should — confirm in Wave 6).
- **Known `interview:{id}:rec-*` inconsistency:** those Map rooms have a dead `plainText`
  column + sync-back today. The Wave-6 structured serializer generalizes the fix — decide
  whether to retrofit the interview rooms onto it or leave them.
- **Form intro doc:** the form *description* already uses `DocEditor(notes)` in local mode;
  trivial to collab-enable alongside the questions in Wave 6 — do it or leave it?

## 16. Editor consistency & shared collab substrate (Tiers 1–3)

"Drive is the browser" (§7) opens a type-specific editor per item. Those editors span two
eras: the shared `DocEditor` (BlockNote + Hocuspocus — realtime multiplayer, continuous
autosave, real undo, version restore) vs. four single-user, manual-save, no-undo editors. This
workstream normalizes them so the "open" experience is coherent. **Decision (2026-08-18): full
commit — Agreement, Forms, and Rubric all move onto the shared collab substrate.**

### 16.1 Current state (editor audit, 2026-08-18)

| Editor (type) | Visual | Functional | Content model | Collab / Autosave / Undo |
|---|---|---|---|---|
| Doc (`DocEditor`) — baseline | 4/5 | 5/5 | BlockNote (full) | ✅ / ✅ / ✅ |
| File | — (viewer) | viewer | preview + download | ❌ / — / ❌ |
| Form builder | 3/5 | 3/5 | custom `Question[]` (+BlockNote for the *intro* only) | ❌ / ❌ / ❌ |
| Agreement | 3/5 | 3/5 | BlockNote **restricted** (images+signing) | ❌ / ❌ / editor-only |
| Email template | 3/5 | 3/5 | plain-text `<textarea>` | ❌ / ❌ / ❌ |
| Rubric | 2/5 | 2/5 | structured JSON criteria | ❌ / ❌ / ❌ |

Systemic issues shared across the non-doc editors: (a) no collab/autosave/undo; (b) off-palette
`blue-*` version sidebars + raw `<input border-gray-300 focus:ring-blue-500>` instead of the
shared kit; (c) swallowed action errors (agreement ×5 intents, email template).

### 16.2 Tier 1 — chrome & token normalization (rides Wave 3)

Cheap, high perceived payoff, no substrate work:
- Kill off-palette `blue-*` (version sidebars, score/info badges) → `accent-coral` / muted;
  includes DocEditor's own `VersionHistoryPanel` `bg-blue-600`.
- Swap raw inputs/buttons for the shared kit (`Button`, `SelectMenu`, `Checkbox`/`Radio`/
  `Toggle`, `DateField`) in `FormBuilder` inner panel, `SigningDocumentDetail` /
  `SigningDocumentsPage`, `RubricDetail`, `EmailTemplateDetail`.
- Surface swallowed errors — wire `useActionData()` for the agreement intents
  (`admin.agreements.$id.tsx`) and email template.
- Fix breadcrumbs — email-template detail → `driveFolderCrumbs`; agreement signed-copy view →
  Drive trail (not Core).
- Remove the decorative non-functional `GripVertical` in `RubricDetail` (real reorder arrives
  in 16.4); delete dead `RubricsContext.tsx` / `mockData`.

### 16.3 Tier 2 — shared "managed editor" shell (Wave 5)

One `ManagedEditorShell` wrapping the non-doc editors: consistent header (inline rename,
save-state indicator, version sidebar), version **restore**, and an unsaved-changes guard.
Extract reusable chrome from `DocumentEditor`. This is the visual/interaction unifier; the
substrate underneath is Tier 3. (Autosave + unsaved-safety largely *come from* Tier 3 collab,
so 16.3 and the prose track of 16.4 ship together in Wave 5.)

### 16.4 Tier 3 — shared collab substrate (full)

**Governing principle — Yjs is the live editing buffer; the existing Postgres JSON column stays
the durable snapshot**, written on Save (Version). This keeps immutable versioning, sidesteps
CRDT-migration risk, and avoids the broken Map-`plainText` / sync-back paths. Downstream
consumers are untouched: response-schema derivation and the stale-submit 409 read
`FormVersion.questions` / `.updatedAt`; issuance and `frozenBody` bake from the saved
`SigningDocumentVersion`. The room persists the *working draft* continuously (this is what
kills lost-work); the immutable *version* stays a deliberate explicit save.

**Substrate is reusable — confirmed (substrate audit, 2026-08-18):** `CollabDocument` is keyed
by an opaque `name` string with **no Page FK** (`schema.prisma:976-989`); non-Page rooms already
exist (`task:*:description`, `partnersow:*:body`, `epic:*:description`, structured
`interview:*:rec-vote`). Auth is session-cookie passthrough + an `entity`-switch in
`authorizeCollabDoc` (`app/collab/collabAuth.ts`) + a `COLLAB_SOURCES` entry
(`app/collab/sources.ts`). Adding an editor needs **no schema migration and no auth rewrite**.

**Prose track — Agreement (Wave 5).** Near-zero new substrate:
- Body → collab room `signing:{documentId}:draft`, rendered by `<DocEditor features="agreement"
  collab .../>` (currently local mode). Inherits DocEditor's full collab stack incl. the
  prod-bundle `UndoManager` duck-typing fix.
- Wiring: 1 `authorizeCollabDoc` branch + 1 `COLLAB_SOURCES` entry + pass
  `parseSessionCookie(request)` as `collabToken` from the loader.
- Version interplay: "New version from vN" seeds the room from that version's body; "Save
  Version" snapshots the room (`readDocAsBlocks`) → immutable `SigningDocumentVersion.body`.
  Issuance/`frozenBody` read the saved version, never the room.
- Preset stays restricted (images + signing fields); it just gains multiplayer/autosave/undo.

**Structured track — Forms + Rubrics (Waves 6–7).** New reusable infra (no schema migration):
- Client: `useSharedArray` / `useSharedMap` (extend `useSharedString.ts`) binding a
  `Y.Array<Y.Map>` to React state, with a native `Y.UndoManager` (not y-prosemirror's plugin —
  so that bug class doesn't apply).
- Server: `readDocAsJson(name)` / `getStructuredData(doc)` parallel to `readDocAsBlocks`
  (`app/collab/read.ts`); a structured serializer in `storeDocument` so Map rooms don't run
  through the prosemirror-hardwired `getPlainText` (`persistence.ts:234-247` returns empty for
  them today); structured sync-back replacing `syncRegistryDocBack`'s `blocks:[]`.
- Rooms: `form:{formId}:draft`, `rubric:{rubricId}:draft`; per-entity auth branch + source.
- Snapshot boundary: Form "Save draft"/"Save as version" → `Form.draftQuestions` /
  `FormVersion.questions`; Rubric "Save Version" → `RubricVersion`. `FormBuilder` and
  `RubricDetail` re-point their local `questions`/`criteria` state onto the shared hook;
  dnd-kit reorder mutates the `Y.Array` — **this is where the rubric's real reorder and
  edit-in-place land**, replacing the fake drag handle removed in 16.2.

**Email — out of the collab tracks.** Its real gaps are test-send + rendered preview + HTML,
not autosave; treat as a small standalone feature in Wave 7 (plus its Tier-1 fixes in Wave 3).

### 16.5 CRDT & realtime caveats (flag in PRs, per CLAUDE.md)

- The buffer/snapshot pattern keeps the durable schema in Postgres, minimizing CRDT-evolution
  risk — but still flag any change to a room's structured shape in the PR (§CLAUDE.md realtime).
- Never decode a live Y.Doc server-side without cloning (`persistence.ts` rule). Prose reuse
  keeps that; structured reads apply the state update into a throwaway Y.Doc (no y-prosemirror),
  so the clone defense is moot but the temp-doc pattern still applies.
- Hocuspocus room growth is minor (refcounted + idle-collected in `collab-doc.ts`).
