# Drive Consolidation — Design & Plan

**Status:** Approved model, implementation started · **Author:** planning pass
with Kiran · **Date:** 2026-08-11 · **Branch:** `feat/drive-consolidation` ·
**Flag:** `drive_consolidation`

Consolidate every user-created item in DALI OS into one Google-*Shared-Drives*-
style filesystem — **Docs · Files · Forms · Agreements** — organized **by
access scope, not by item type**, with new item types (**external embeds**,
then databases/whiteboards) deferred to the tail. Ships as **one feature-flagged
push**.

---

## 0. The model in one paragraph

The Drive is organized into **scopes ("drives")** — *My Drive* (private), *Lab*
(everyone), *Core*, each *Project*, each *Offering*, and any *group*. **A scope
is a group**: access to a drive = membership in its backing `GroupDefinition`,
resolved live by `resolveGroupMembers`. **Folders cascade their scope's access
downward**; a sub-folder may *narrow* (never widen) it. **Named `PageShare`
grants are the additive "shared-with-me" exception**, and **publish / link /
sign mechanisms are orthogonal outward channels** independent of placement.
Because access is a live projection of current group membership, **term
progression is a non-event**: drives belong to *seats*, so access flows to
whoever holds the role now — no annual re-sharing.

---

## 1. Current state (audited)

### 1.1 Documents / Pages — already ~80% a Drive
One polymorphic table, `Page` (`schema.prisma:3795-3943`): `workspaceType`
(`Lab | Project | EducationOffering | Member`, `:4074`); loose `workspaceId`;
`parentPageId` self-relation (`:3915`, **2-level cap** in the app layer);
`kind` (`FreeForm | Structured | Folder`, `:4084`); `contentDocId` →
`CollabDocument` (`:992`, Yjs/BlockNote) + `CollabDocumentVersion` (`:1011`);
Notion metadata; named `PageShare` (`:3970`, tiers `View < Comment < Edit <
FullAccess`, `enum SharePermission :4048`) **plus** General access
(`linkAccess`/`linkPermission`, `:3885`, `enum LinkAccess :4061`). **Pages carry
no `termId`** — the hub's term dropdown filters at the *project* level
(`documents.hub.tsx:138`, `projectTerms: { some: { termId } }`). Access resolved
in one place: `getPageAccess` (`app/lib/pageAccess.server.ts`) — **per-item,
additive, never subtractive**; **Member workspace gives Core no bypass**
(`:179-193`).

### 1.2 Forms — a parallel filesystem
`FormFolder` (`:3487`, arbitrary-depth tree) + `Form` (`:3519`) → `FormVersion`
→ `FormSubmission`. Two independent access axes: **manage** the definition
(`canViewForms` = Core/Instructor, `roles.ts:443`) and **fill** it
(`FormAudience`, `:3512`: `Members | SignedIn | Groups | Public`, via
`publicToken`). Backbone of education/partner/staffing/onboarding/feedback
flows. Own browser UI (`FormsBrowser.tsx`, dnd-kit). Only overlap with Docs: the
shared `DocEditor`.

### 1.3 Project files
`ProjectFile` (`:1076`) → `ProjectFileVersion` (`:1121`, S3 `s3Key`). Tags
(`ProjectFileTag`, same `DocTag` registry as Pages), comments (`DocComment`,
`:1152`), task links (`TaskFileLink`, `:1109`). Sharing = one `partnerVisible`
boolean. Flat, project-scoped, no folders. Files embedded in doc bodies are S3
keys buried in Yjs state — invisible to any index.

### 1.4 Signed agreements
`SigningDocument` (`:1546`, template) → `…Version` → `SigningBinding` (`:1634`,
version in force for a scope) → `SigningSignature` (`:1663`, frozen copy).
Authored in Admin; signed via `/sign`; a user's signed copies live in Settings →
Agreements. No folders/tags/search.

### 1.5 Groups — the key existing primitive
`GroupDefinition` (`:1969`) already supports **dynamic groups** via
`dynamicQuery` with recognized forms **`core`** ("Core members for the current
term"), **`project:<id>`** ("members assigned to that project, *any term*"),
**`domain:<id>`**, **`term:<id>`** — plus **static** groups (`staticMemberIds`),
**system-managed** auto-synced groups (`systemKey`), and term-bound auto-archive
(`boundTermIds`). `resolveGroupMembers` (`app/lib/groups.ts:9`) resolves any of
these to userIds. **`PageShare` already accepts a Group principal** and walks
membership through `resolveGroupMembers`. This is what makes "a scope is a group"
nearly free.

### 1.6 Navigation
One registry (`app/lib/nav-areas.ts`, `NAV_AREAS`) drives the sidebar
active-area dropdown **and** the ⌘K "Go to" list. Documents (position 5,
ungated) and Forms (position 9, `canViewForms`) are separate sibling leaf areas.
`/api/search` (`search.server.ts`) already returns typed `document`, `form`,
`formFolder` results. Two hand-rolled trees exist (`UnifiedTree` HTML5 DnD;
`FormsBrowser` dnd-kit) — no shared component.

---

## 2. Access model: **scope = group, cascade down**

### 2.1 A scope is a group
Every drive is backed by an access principal:

| Drive | Principal | Backing | Status |
|---|---|---|---|
| 🔒 **My Drive** | `Private` | owner only (+ note visibility flags) | special — the *only* non-group scope |
| 👥 **Lab** | `Lab` | `isLabMember` / `LinkAccess.LabMembers` | exists (#1135) |
| ⭐ **Core** | `Group` | dynamic `core` | **group exists** |
| 📁 **Project X** | `Group` | dynamic `project:<id>` | **group exists**, auto-synced |
| 🧭 **Domain** | `Group` | dynamic `domain:<id>` | **group exists** |
| 🗓 **Term cohort** | `Group` | dynamic `term:<id>` | **group exists** |
| 🎓 **Offering** | `Group` | dynamic `offering:<id>` | **new dynamicQuery form** |
| 👥 **Ad-hoc** | `Group` | any static/dynamic group | free (People → Groups) |

My Drive stays special (owner-only, preserves `profileVisible`/`labListing`, and
the **no-Core-bypass** invariant). Everything else resolves through
`resolveGroupMembers`.

### 2.2 Scope lives on the folder, cascades to contents
Add three **additive, nullable** columns to the scope-defining folder (a `Page`
with `kind = Folder`, i.e. a *drive root* or a *narrowing sub-folder*):

```prisma
// On Page (meaningful only when kind = Folder; null elsewhere / on inheriting folders)
scopeKind       ScopeKind?       // Private | Lab | Group   (null = inherit ancestor)
scopeGroupId    String?          // FK → GroupDefinition, when scopeKind = Group
scopePermission SharePermission? // base level members get (default View for Lab, Edit for Group/Private roots)

enum ScopeKind { Private Lab Group }
```

**Effective scope of any item** = the nearest ancestor folder (including itself)
whose `scopeKind` is non-null — the *governing folder*. Drive roots always
declare a scope; ordinary folders inherit (null); a sub-folder may declare a
**narrower** scope to override.

### 2.3 Additive & incremental — no backfill in Wave 1
The resolver derives the governing scope **from explicit folder scope if set,
else falls back to the item's existing `workspaceType`** (Lab→Lab, Project→
`project:<id>` group, Education→`offering:<id>` group, Member→Private). So:
- Wave 1 (surface merge) changes **no access logic** — existing docs/forms keep
  today's `getPageAccess` result.
- The scope columns are added additively (nullable, no data loss — passes
  `migration-check`). **No backfill required**; existing pages derive their scope
  from `workspaceType` until/unless explicitly re-scoped.
- New group-backed drives (Core, ad-hoc) and sub-folder narrowing are the only
  things that *set* explicit scope columns.

### 2.4 The resolver change (`getPageAccess`)
Extend to:
1. Walk from the item up the `parentPageId` chain to the governing folder (or
   fall back to `workspaceType`-derived scope at the root).
2. Resolve the scope's member set: `Private`→owner; `Lab`→`isLabMember`;
   `Group`→`resolveGroupMembers(scopeGroupId)`. Grant `scopePermission`.
3. **OR** the additive named `PageShare` grants + General/link access (public
   link, partner-visible), exactly as today. Creator always keeps a base grant.
4. **Never widen by nesting** — a sub-folder's scope may only narrow; the
   resolver takes the *most restrictive* governing scope on the path, then adds
   explicit shares. (Widening is only ever via named share or publish/link.)

Invariants preserved: additive-only; Member/My-Drive gives Core no bypass; the
Member branch runs **before** the Core shortcut.

### 2.5 The three rules (say them in the UI)
1. **Placement governs who can see/manage** an item (via cascade).
2. **Nesting only narrows.** You cannot accidentally widen access by dragging
   something deeper; widening is always an explicit act.
3. **Publish / link / sign are orthogonal outward channels.** A form in a
   private Core folder, once published, is fillable by its `FormAudience`
   *regardless of placement*. A file's public/signed-URL link, an agreement's
   sign gate — same: independent of where the item is filed.

---

## 3. Item types under the model

- **Docs** — governed by folder scope + named shares (as today, now cascaded).
  Outward channel: public write-up / partner-visible.
- **Files** (`ProjectFile`) — gain workspace scope + `folderPageId` so they
  place into the tree and inherit folder scope; keep versioning/tags/comments/
  task-links. Generalize `PageShare` to files (one sharing UI/resolver). Outward
  channel: public/signed-URL link (mint short-lived URLs — never expose the
  bucket). Promote doc-embedded uploads to first-class listed files.
- **Forms** — gain `folderPageId` + scope so they file into the tree; **folder
  placement governs manage-access**, `FormAudience` + `publicToken` stays the
  **fill** gate (untouched). Migrate `FormFolder` → `Folder` Pages; deprecate
  `FormFolder`. Response pipelines and application bindings unchanged.
- **Agreements** — a read-only **My Agreements** shelf in My Drive from
  `listMySignedDocuments()` (immutable, PDF download). Signing *templates* live
  in Core/Admin. The `/sign` gate is untouched (the outward channel).
- **Templates** — an aggregating **Templates** lens (`templates.server.ts`)
  over the five existing systems (`PageTemplate`, `Form` drafts,
  `MentorNoteTemplate`, `EmailTemplate`, `SigningDocument`), normalized to one
  `TemplateItem` shape; each "use" routes to the existing create-from-template
  path. No new storage.

---

## 4. Term progression

**Handled by construction.** Access is a live projection of current group
membership, so drives belong to *seats*, not people:
- New Core → auto-gains the Core drive; docs don't move (**stewardship transfers
  with the role**). Rotating off Core → auto-loses it, but keeps **creator base
  access** to anything they authored (softener), optionally a grace window.
- Members staffed onto a project this term → auto-gain that project's *entire
  accumulated* drive (`project:<id>` is cumulative, "any term").
- **No annual re-share chore** — a per-item-share model would require re-granting
  every rollover; this doesn't.

**Term is a filter, not a structural axis.** Pages carry no `termId` and we keep
it that way — no `termId` on pages, no forced term-folders (a scope×term 2-D
tree buries long-running projects). Keep the existing `TermFilter` facet over any
drive; teams make their own "26S retros" folders when they want to.

**Departure / graduation** = the terminal case of the same mechanism: group
memberships lapse → seat-drives drop automatically; **My Drive becomes read-only
/ exportable, not deleted**; promoted (`labListing`) / shared items persist.

**Two decisions this forces:**
1. **Project drives cumulative (default) vs current-term-only** — cumulative
   suits a learning lab; add a per-project "current members only" toggle later
   for sensitive/partner projects. *(open — default cumulative for v1)*
2. **Core drive backed by live `core` (rotates) — recommended** (seat
   semantics; creator-access softens the boundary).

*(Optional polish, not core:* a term-rollover job — reusing the jobs runner +
`boundTermIds` auto-archive — could create each project's new-term meeting-notes
folder and archive term-bound cohort folders.*)*

---

## 5. Tree UI reconciliation
Build one **`DriveTree`** (dnd-kit; `FormsBrowser` already proves arbitrary-depth
move + cyclic-move guards) driven by a normalized **`DriveItem`** shape assembled
by `app/lib/drive.server.ts` (queries each backing table, runs every item
through `getPageAccess` **per viewer**, normalizes to one row). Reuse existing
chrome (`PageIcon`, `FavoriteStar`, `TagPicker`, `TermFilter`,
`components/sharing/MoveToDialog`, doc chrome). Scope-first structure (drives as
top-level sections; **My Drive is a hard-separated section**, not draggable-into
by accident); item type is a *filter within* a scope. Retire `UnifiedTree` +
`FormsBrowser` at parity. Moves that cross a scope boundary get a **loud
before→after confirm** stating item count and old→new scope.

---

## 6. Navigation integration
1. Replace `documents` + `forms` `NAV_AREAS` entries with one `drive` area
   (`/drive`) — updates sidebar dropdown **and** ⌘K "Go to" automatically. Drive
   is all-members; Forms content + Admin-only lenses gate per-lens.
2. Keep `/documents/*` and `/forms/*` as redirects/aliases (preserve deep
   links, exports, the anon `/documents/:id/public` viewer at `routes.ts:465`,
   and the external unauthenticated `/forms/fill/:token`).
3. Merge the ⌘K `Documents` + `Forms` sections into one **Drive** section
   (`CommandPalette.tsx` `TYPE_META`/`SECTION_ORDER`); extend `SearchResultType`
   + `search.server.ts` for `file`, `template`, `agreement` (later `embed`).
4. One consistent open action (split-pane for editable, plain nav for read-only
   shelves).

---

## 7. Privacy & risk guards (load-bearing — explicit tests)
- **Core has no god-view over My Drive.** Personal notes appear only in the
  owner's My Drive — never in any shared projection, search, move-destination
  picker, or API, for anyone. Member branch runs before the Core shortcut.
- **Nesting only narrows; cross-scope moves confirm loudly** (before→after
  audience, item count).
- **Forms/agreements placement is manage-access only** — never changes who can
  fill/sign (the orthogonal outward channel).
- **Sharing stays additive** — `access = max(scope base, named share, general
  access)`; never below a scope's base.
- **Public file links mint short-lived signed URLs**, never bucket exposure.
- **Per-viewer projection** — never render a title the viewer can't open (filter
  it, matching `visibleLabDocFilter`); a viewer never sees a drive they're not in.
- **Collab/CRDT caveat (CLAUDE.md):** any doc-body/block serialization change
  needs pm↔y round-trip care; flag in the PR.
- **Migrations additive/nullable** — no drift, no data-loss (passes
  `migration-check`); `FormFolder` drop is a *later* migration after UI cutover.

---

## 8. Rollout — one flagged push (`drive_consolidation`)
Single branch, gated by one flag, dark-launched to Core → everyone. Internal
build order (the flag hides intermediate states):

**Wave 1 — Surface merge (no access change, no migration).** One `drive`
`NAV_AREA` + route aliases; `DriveItem` type + `drive.server.ts` loader over
existing Pages/Forms/Files/agreements using **today's** `getPageAccess`;
`DriveTree` shell; hub route; ⌘K merge. Behind the flag.

**Wave 2 — Scope = group cascade (access model).** Additive `scopeKind`/
`scopeGroupId`/`scopePermission` columns; lift the 2-level nesting cap;
`offering:<id>` dynamicQuery; extend `getPageAccess` to walk ancestry → resolve
group → additive shares (fallback to `workspaceType`-derived scope). Core drive +
ad-hoc group drives become creatable. **No backfill.**

**Wave 3 — Files + Forms into the tree.** Workspace scope + `folderPageId` on
`ProjectFile` and `Form`; generalize `PageShare` to files; migrate `FormFolder`
→ `Folder` Pages; cut `FormsBrowser` → `DriveTree`; promote doc-embedded uploads.

**Wave 4 — Agreements shelf + Templates gallery.** Read-only My Agreements lens;
aggregating templates lens + create-time picker.

**Deferred (new item types, the tail / fast-follow):**
**Wave 5** external embeds (`DriveEmbed` + embed blocks: bookmark → Figma →
Drive → GitHub); **Wave 6** structured databases, then whiteboards — own specs.

---

## 9. Open decisions (non-blocking; defaults chosen)
1. Project drives **cumulative** (default) vs current-term-only toggle. §4.
2. Core drive on **live `core` group** (default, seat semantics). §4.
3. `ProjectFile` **additive columns** (default) vs `DriveFile` rename. §3.
4. Generalize `PageShare` to files (default) vs parallel `FileShare`. §3.
5. Nesting depth cap — arbitrary vs a sane bound (e.g. 6) for query cost. §2.

---

## 10. Key files
- Schema: `prisma/schema.prisma` (`Page :3795`, `PageShare :3970`,
  `PageTemplate :4092`, `ProjectFile :1076`, `DocComment :1152`, `Form :3519`,
  `FormFolder :3487`, `SigningDocument :1546`, `GroupDefinition :1969`; enums
  `WorkspaceType :4074` / `PageKind :4084` / `SharePermission :4048` /
  `LinkAccess :4061` / `FormAudience :3512` / `GroupType`).
- Access & groups: `app/lib/pageAccess.server.ts` (`getPageAccess`),
  `app/lib/page-share-access.server.ts`, `app/lib/lab-documents.server.ts`,
  `app/lib/groups.ts` (`resolveGroupMembers`, `resolveDynamicQuery`).
- Docs UI: `app/routes/documents.hub.tsx` (`UnifiedTree`),
  `app/routes/documents.$pageId.tsx`, `app/components/DocumentEditor.tsx`,
  `app/components/doc/` (`DocEditor`, `features.ts`, `schema/`).
- Move/share: `app/projects/routes/api.pages.$id.move.ts`,
  `app/components/sharing/MoveToDialog.tsx`.
- Forms: `app/forms/components/FormsBrowser.tsx`, `app/forms/lib/forms-data.ts`,
  `folder-tree.shared.ts`, `public-form.ts`.
- Signing: `app/signing/routes/admin.agreements.tsx`,
  `AgreementsSettingsBlock.tsx`, `listMySignedDocuments()`.
- Nav/search: `app/lib/nav-areas.ts`, `app/components/Layout.tsx`,
  `app/components/CommandPalette.tsx`, `app/lib/search.ts` + `search.server.ts`,
  `app/routes.ts`, `app/lib/feature-flags.ts`.
