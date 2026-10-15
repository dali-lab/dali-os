# Drive and meeting notes review

Status: **built**, 2026-10-13. Decided after two adversarial reviews (sections
6, 7); every phase in section 5 is merged or open as a PR, flags off. See
"Shipped" at the end of section 5 for PR numbers and the operator steps left. Written after a
read of the current `staging` code (Drive spaces, `DriveBrowser`, bindings, page
access, notebooks, `scheduled-meeting.ts`) and a research pass over Finder, Google
Drive, Dropbox, Box, Notion, Granola, Fellow and Notion Calendar.

Related specs: `drive-spaces-redesign.md` (the "Drive mirrors nav areas" decision),
`drive-consolidation.md` (scope = group cascade), `meeting-recording-rail.md`.

## 1. What is actually there today

Findings that matter for the discussion, with the surprising ones first.

- **Five root spaces, nothing else.** `DRIVE_SPACES` is My Drive, General (Lab),
  Projects, Education, Core (`app/lib/drive-spaces.ts:70`). Hiring is an ordinary
  Core-scoped folder since #1956 (Oct 4, "hiring can be a subfolder of core").
  Mentorship has no Drive presence at all.
- **Mentor notes are not Pages.** `MentorNote` is its own table keyed on
  (mentor, mentee, project, term, domain, weekOf) with `contentJson`
  (`schema.prisma:5599`). It has no workspace, folder or scope. A "Mentorship"
  root folder therefore cannot be a folder binding; it is either a virtual listing
  or a data migration.
- **A notebook is an invisible doc.** It is a `FreeForm` page with no body and a
  unique `notebookKey`; notes are its children (`pages.ts:116`). Drive renders it
  with the same `FileText` glyph as any doc. Opening it redirects to a tab. The tab
  rail (`documents.$pageId.tsx:465`) has no add, rename, reorder or remove
  controls.
- **The notebook is chosen by a hash, once.** `meetingNotebookIdentity`
  (`meeting-notebook.ts:50`) keys Team/Partner notes on project + type + term and
  everything else on `bucket:audience`, where audience is either the group id or a
  sha256 of the sorted guest list. The key is computed when the note is created
  and never recomputed. Changing the guest list, flipping Core, or a
  "this and following" edit silently starts a second notebook.
- **Filing is a four-branch precedence, not a choice.** Project wins over Core,
  Core wins over the organizer's chosen location, General falls back to the Lab
  "Meeting assets" shelf (`scheduled-meeting.ts:416`). Two different folders are
  both titled "Meeting assets" (Core binding and Lab binding). Projects get
  "Team meetings" and "Partner meetings". The create toast does not say where the
  note went.
- **A Core check-in with a project is filed in the project, and is lab-readable.**
  The Core folder and the `core:` bucket are not used when `projectId` is set.
  Project-workspace pages give every lab member view and comment
  (`pageAccess.server.ts:366`), and tabs copy the notebook's workspace, so the
  whole lab can read a Core check-in note today.
- **No pointer, alias or multi-parent exists.** `parentPageId` is a single column
  and files, forms, agreements and rubrics each have one nullable `folderPageId`.
- **No access information reaches a Drive row.** `DriveItem` carries no owner,
  audience, `linkAccess` or `scopeKind`. The only audience text is a hardcoded
  string per space ("Core only", "Project members") shown on hover on the space
  row. `listPageShares` exists but is reachable only through the manager-gated
  share dialog `state` intent. The share dialog does not show inherited folder
  scope, and its base-access line is static text per workspace type, which is
  wrong for pages under a scoped folder.
- **There is no "Shared" or "Shared with me" space in Drive.** The only
  "shared with me" query is for personal notes on the profile rail
  (`personal-notes.server.ts:150`). A Lab or project doc shared to someone outside
  that workspace appears nowhere in their Drive. Nothing computes "shared by me".
- **CRUD is one-way.** A note can be created and trashed. It cannot be detached
  from its meeting, re-attached to another, or moved into a notebook (the move
  route rejects non-folder parents). A notebook cannot be created, renamed with
  intent, merged, or deleted safely (deleting archives the container and leaves
  the tabs live under it). The meeting edit route freezes type, project, Core and
  notes. There is no way to unset a project. Cancel never touches notes. MCP has
  no notebook tool and no `update_meeting`.
- **Two regressions from the notebook refactor** (#2001): later-occurrence notes
  pass the notebook id as `noteLocation`, which is not a folder, so a replacement
  notebook lands in Lab "Meeting assets"; and a General meeting's whiteboard is
  no longer co-located with its chosen folder for the same reason.

## 2. Problems mapped to causes

| Pain point | Cause |
|---|---|
| "Where did that go" | Filing precedence is silent; the toast never names the folder; no Location column, no Reveal in Drive; notebooks look like docs |
| "Where should that go" | Type (Team/Partner/Other) stands in for the real question, which is "which notebook"; two folders share a name |
| Hand-made "meeting notes folders" | People cannot see the auto-made ones as different, and cannot pick a notebook, so they make folders instead |
| Core check-in filed in one place | One parent per page; no alias concept |
| Have to open Share to know who can see | Access is resolved per viewer on the server and never summarised; no bulk audience query, no avatar stack component |
| "Shared" vs "shared with me" | Drive has neither; the only shared view is on the profile rail and is personal-notes only |
| Drive feels barebones | Rows carry four signals total (type glyph, process pill, partner handshake, star); folders have no counts, colors or covers; no Home or Recent; no Location column |

## 3. Proposal

### A. Roots are hardcoded, everything below is free

The root set is a registry in code: My Drive, General, one root per project,
one per education offering, Core, Hiring, Mentorship, Shared with me. Core,
Hiring and Mentorship are **real folders created at runtime by `ensureRoot`**,
serialized by a partial unique index on (processType, processId, folderType)
where `archivedAt IS NULL`, called from the Drive loader, every filer and the
seed. Not a migration: CI runs `migrate reset` then `db seed`, so the Core
group does not exist at migration time. Roots are found by (process type,
process id, `folderType = Root`). Project and offering roots are their
workspaces; **General is the Lab workspace root** (unscoped top level), which
is what "under the root" means for Lab receivers. Shared with me is computed.
Root order is code. A process root space is visible to whoever can view the
root folder (`getPageAccess(root).canView`), replacing the `RoleFlags` gate in
`drive-spaces.ts` and the Library nav gate.

A root is a normal folder with two guards: it cannot be trashed and cannot be
nested. Everything else about it is data: title, emoji, and **sharing**, which
is what decides who sees the space. No per-space role gate in code.

- **Hiring**: Core only by default (decided; the `hiring` group has no cycle
  filter and would admit every past interviewer). Core can widen it in Share.
- **Mentorship**: scope = the `mentors` group (current-term mentors plus
  Core), View, plus a Core group share with Edit on the root so Core can make
  folders and mark receivers there. Mentees never see it.
- **Core**: Core group, Edit. Converted from a virtual filter to a real folder,
  which also closes the Core ▸ Core class of bug (a filter matching its own
  shell). **Migration**: there is no Core root today; every bound folder was
  created at Lab top level. Phase 1a re-types the legacy "Core" page
  (`cmsqbjq910000iks9nhhh0g6i`) as the Core root, reparents every Lab
  top-level folder with `scopeKind = Group(core)` under it except the three
  hiring folders, which go under the new Hiring root, and verifies no subtree
  is already at depth 6 (`MAX_PAGE_DEPTH`). Scope derivation switches from
  `scopeKind` to "nearest Root ancestor's process" in `drive-crumbs.server.ts`,
  the hub, `DriveBrowser` and the drive e2e. A folder later scoped to the Core
  group outside the Core root stays where it is (Core-only visible in General),
  a documented behaviour change.

**Nothing auto-creates a subfolder.** The hiring forms, application templates
and rubrics folders, Core's agreements and templates folders, the certificate
backgrounds folder, the Lab and Core "Meeting assets" shelves, and the
per-project Team and Partner meeting folders all stop being created. The ones
on prod stay as plain folders; nothing files into them unless a user marks
them as receivers (B2). Anything a feature creates lands at the owning root
unless a receiver exists.

User-created roots with no process behind them (a Partners or Alumni space)
are allowed by the columns (`Root`, no owner) but not built now. Roots are
never user-bound: a binding needs fallback states for unbound, trashed and
moved folders, which is the machinery this spec removes.

### A2. Mentor notes migrate to Pages

Decided 10-12. `MentorNote` rows become notes in a per-pair notebook, so the
weekly mentor note is the same object as a meeting note: a tab in a notebook,
with a template, sharing and Drive CRUD.

- Bodies already live in collab rooms (`mentorNote:<id>:body`, seeded from
  `contentJson`). A page body room is always `doc:<pageId>:body`, so the
  migration creates one Page per `MentorNote` and renames the `CollabDocument`
  and `CollabDocumentVersion` rows to that name, materialising a room from
  `contentJson` for notes never opened in collab. The three `contentJson`
  readers (read view, mentor-note API, MCP `get_mentor_note`) switch to
  `readDocAsBlocks` and `app/collab/sources.ts` stops writing `contentJson`
  back on save, in the same PR. No content rewrite.
- Structured fields (`vibe`, `weekOf`, mentor, mentee, project, term, domain)
  stay on `MentorNote`, which gains `pageId` (1:1). The owning model keeps its
  fields; the Page is the body and the Drive presence.
- The pair notebook is found or created by the tuple (mentor, mentee, project,
  term, domain); `MentorshipPair` ids churn on every finalize so nothing keys
  on them. Tabs are ordered by `weekOf`. The notebook lands in Mentorship's
  mentor-notebook receiver if Core has marked one (a "26F" folder, say), else
  at the Mentorship root, and inherits the root scope (mentors plus Core,
  View). The Drive term filter applies to the Mentorship root either way.
- **Edit is granted explicitly, per page.** Under a View scope the creator
  softener grants View, not Edit; Core does not bypass a governing scope; and
  shares on a notebook do not reach its tabs. So the notebook and every note
  tab get, at creation, a User share Edit for the authoring mentor and a Group
  share Edit for Core. Test: the author edits their note under the View root,
  another mentor only reads, Core edits. No mentee access, matching today.
  `canViewMentorNote` is replaced by page access.
- "Mentors" is not a group today (`isLabMentor` is a per-term predicate). Add a
  `mentors` dynamic kind (resolver, batch flags, inverted predicate, seeded
  system group) = current-term `isLabMentor` plus Core, matching today's
  visibility, so a past mentor loses old notebooks exactly as today.
- Create paths that must also create the Page and notebook: the mentor-notes
  API upsert, MCP `manage_mentor_note`, the migration, and the seed. No job
  creates mentor notes.
- `MentorNoteTemplate` becomes the notebook's `templatePageId`; the Mentorship
  root carries the default template id for new pair notebooks.
- `/mentorship/browse` becomes a Drive view of the Mentorship root. The
  mentor-note editor route keeps its URL and renders the notebook tab.
- The "Not filled in" filter and the Slack nudge keep working off `MentorNote`.

### B. Notebooks become first-class, and the meeting types go away

**Model**

- `PageKind` gains `Notebook`. Existing notebook pages migrate to it;
  `notebookKey` is dropped after backfill (it was only the auto-grouping key).
- `ScheduledMeeting.notebookId` (nullable FK) is the series' default notebook.
  Each occurrence note keeps `meetingNoteId` + `meetingOccurrenceStart` and is a
  child of the notebook. A note's notebook is its parent, nothing else.
- Notebook fields that replace what `meetingType` used to decide:
  `templatePageId` (per-notebook default template; the project
  `meetingNoteTemplateId` becomes the default for new notebooks in that project),
  location (its folder), and title.
- `meetingType` / `meetingTypeLabel` stay in the DB for the migration and go out
  of every create surface. Team/Partner/Other picked a folder, a template, a
  notebook key and a label, and gate attendance tracking at five sites (see
  section 6); those are re-keyed before the type leaves the UI. The partner
  portal has no dependency on it (verified by grep).
- A single note is a notebook with one tab. The tab rail is hidden until there
  are two. Drive shows a notebook as one item with a notebook glyph and a tab
  count; tabs never render as loose docs.

**Create flow** (`CreateEventModal`, `AddMeetingNoteModal`, desktop one-tap)

1. "Meeting note" toggle on.
2. Notebook: **Add to existing** (a picker over notebooks the user can edit,
   recent first, with "suggested" = notebooks this series, project or guest set
   has used before) or **New notebook** (name prefilled from the meeting title;
   location = folder picker defaulting from About; template).
3. The choice is stored on the series (`notebookId`), so every later occurrence
   files itself with no prompt. Granola's "also file future meetings here?" is
   the confirm copy when a note is added post-hoc to a series that already has a
   different default.
4. Toast: "Filed to Core ▸ Weekly check-in" with **Open notebook** and
   **Undo** (Undo is defined in section 6).

**Project defaults**: nothing is pre-created. A new notebook lands in the
project's Meetings receiver if one is marked, else the project root.

### B2. Receiver folders: the folder declares what it receives

`ProcessFolderBinding` and its four settings surfaces are deleted. In their
place, a folder carries what it receives, user-set and optional:

- `Page.folderType` enum: `Root`, `Meetings`, `HiringForms`,
  `ApplicationTemplates`, `Agreements`, `EducationTemplates`,
  `CertificateBackgrounds`, `MentorNotebooks`. No `Rubrics` or
  `EmailTemplates`: nothing in app code creates a rubric or files an email
  template. Seeded rubrics with null `folderPageId` list at the Hiring root.
- `Page.processType` / `Page.processId`, nullable, set on roots and on process
  receivers. `ProcessType` gains `Mentorship`; Hiring uses `HiringCycle` with
  the existing `hiring` sentinel id.
- **Cardinality**: `Meetings` is a hint, any number of folders may carry it and
  the picker lists them first. Process slots are receivers, one per process:
  unique on (processType, processId, folderType). Marking a second folder
  prompts "Hiring forms currently go to X. Switch?" and clears the old one.
- **A receiver must live under its process root** (hiring forms inside Hiring,
  a project's Meetings inside that project, mentor notebooks inside
  Mentorship). "Under" for workspace roots = same `workspaceType` and
  `workspaceId` at any depth; for Lab = Lab workspace with no process-root
  ancestor, so General may hold one `(Lab, "lab", Meetings)` receiver and any
  number of `Meetings`-hint folders. Scoping is then right by inheritance.
  The check runs once per move over the moved subtree's folders (the subtree
  move already computes every descendant id); moving a receiver out of its
  root clears the type with a confirm. MCP `manage_page` must allow nesting a
  folder under a root. Trashing a receiver clears its type, one way, said in
  the confirm, so the unique index never blocks a replacement or a restore.
- **Filing sets `folderPageId` to the root id, never null**, since
  `loadAgreements` and `loadRubrics` hide null placements.
- **Templates are identified by a stable key, never by folder.**
  `ensureHiringTemplate` and `ensureEducationTemplates` find the template by
  name plus `folderPageId` today, so switching a receiver would fork a blank
  template that every later cycle clones. They gain a `Form.templateKey`.
- The hub's hiring-library drill opens the Hiring root in scope `hiring`
  instead of the `hiring-forms` binding. The project delete route stops
  excluding bound folders by binding and instead ignores empty folders when
  counting blockers, and the per-load backfill of the two project meeting
  folders is removed, or every project ever opened returns 409 on delete.
- Certificate backgrounds file as `(Core, "core", CertificateBackgrounds)`
  under the Core root. `ProcessType.Lab` and `CertificateTemplates` stay as
  dead enum values. Mentorship's process id is the sentinel `"mentorship"`.
  There is no EducationOffering Meetings receiver (no filer).
- **Filing rule**, every feature: the receiver if one exists, else the process
  root. No `ensure*`, no fallback states, because the root always exists.
- **Two entry points, one write**: the folder's own settings ("This folder
  receives: hiring forms") and the process settings page (pick a folder, which
  sets the same columns). Both reuse `FolderPicker`.
- **Row rendering**: glyph by type plus a pill naming what the folder receives.
- A `Meetings` folder may still hold ordinary docs. Types are hints and
  defaults, not cages.
- No backfill of today's bound folders as receivers. They become plain folders;
  Core re-marks the ones they want in a minute from the folder settings. The
  binding-collision pre-check from the review is moot.

### C. Filing into several places: primary placement plus shortcuts

The file-in picker is **multi-select**. The first selection is the primary
location by default and can be changed with one click on the chip. The confirm
button and the toast both name the primary ("Primary: Project X ▸ Meetings").

What the multi-select writes is a primary placement plus one shortcut per extra
location, not true multi-parenting. Reasons, in order of cost:

- `Page` has one `workspaceType`/`workspaceId`, and every Drive loader, the
  project Documents block, the move endpoint, partner visibility and collab auth
  key off it. True multi-parent across workspaces needs a `PagePlacement` join
  table and a rewrite of every workspace-keyed query.
- Access would have to become a union of the parents' audiences, which ends the
  "nesting only narrows" invariant that the #1958 folder-scope fixes rely on.
- Remove-from-folder versus delete needs its own semantics (trash only when the
  last placement goes). Google retired multi-parent in 2020 over this.
- Folder moves become graph operations with cycle detection.
- The URL, breadcrumb and Location field still need one path, so a primary flag
  is needed anyway.

**Shortcut model**

- `PageKind` gains `Shortcut`; `Page.targetPageId` (FK, cascade delete). A
  shortcut is placed like any page. It has no body, no shares, no scope.
- **Placing into a folder shares with that folder's audience**, under the
  grant contract in section 6: the actor needs edit on the folder and
  manage-sharing on the target, the principal is chosen per destination type
  (an unscoped Lab folder grants nothing), the shortcut records the share it
  created and chip removal deletes only that. Union access through an
  existing, auditable, revocable primitive, visible in the share dialog and the
  row's audience signal. Removing the primary promotes the next chip.
- Visibility of the shortcut row follows its folder. Opening it follows the
  target's access. Where the grant was declined or later revoked, the row shows
  a lock and the request-access path.
- Deleting a shortcut deletes only the row. Trashing the target marks its
  shortcuts "Original in trash". Moving the target does not break shortcuts.
- Rendering: the target's glyph with a small arrow badge. Details pane for a
  shortcut: "Original: Project X ▸ Meetings ▸ Check-ins" with Open original.
  Details pane for a target: "Also in: Core ▸ Check-ins".
- **Core check-in**: no special case. Primary in the project's Meetings
  receiver or project root, shortcut plus Core grant in Core's Meetings
  receiver or Core root, both prefilled in the same picker when
  `isCoreMeeting && projectId`. One shortcut per
  notebook, not per note. "Add shortcut to…" is also a row action on any item.

If true multi-parent is still wanted later, it is its own phase: `PagePlacement`
with a primary flag and a union access rule, estimated at several times the
shortcut work because of the loader rewrite.

### D. Who can see this, inline

- New bulk server function (next to `getPageAccessBulk`) that summarises
  audience per item, viewer-safe:
  `{ kind: private | people | group | project | lab | public, label, count,
  inheritedFrom?: {folderId, title}, permission }`, plus `people: up to 3
  {id, name, photoUrl}` only when the viewer can manage sharing on the item.
  One `PageShare` query and a governing-scope map computed in-process from the
  rows the Drive loader already holds (section 6, performance). Group sizes
  resolve in the Share dialog, not the row.
- Row signal, always on, compact: a lock (private), an avatar stack with "+N"
  for managers or a people glyph with a count for everyone else, a group chip
  ("Core", "Project team"), or a globe (lab-wide, public). Hover shows the
  inherited-from folder. Click opens Share.
- Details pane gains "Who can see this" with the list, the inherited-from folder
  as a link, and Manage for managers.
- Share dialog gains an "Inherited from folder X" block and a computed
  base-access line.
- Folder glyph tint follows audience (Box's model: private, team, group, lab),
  so the folder band reads as an access map without hover. Emoji icons stay a
  personal choice on top.
- Files under an unscoped folder are visible to any authenticated member today.
  The summary will expose that honestly. Closing it is open decision 12.

### E. Shared with me

- New root space **Shared with me**: pages in any workspace, personal notes
  included, where the viewer holds a `PageShare` (direct or via group) and does
  not already see the page through workspace membership. Sorted by share date,
  with a "Shared by" column. Google's and Notion's models agree on this
  definition.
- "Shared by me" is a filter inside that space (OneDrive's two tabs), not a
  second space.
- The "Shared" folder under My Drive on prod is hand-made (decision 6).
- Computation and the Core caveat are in section 6, UX.

### F. Make the browser feel like a filesystem

Ordered by effect for effort.

1. **Glyphs that mean something.** Three new glyphs cover every new concept:
   a notebook glyph (`NotebookPen` or `BookOpen`, coral, tab count badge), the
   target's glyph with an arrow badge for shortcuts, and a folder glyph with a
   calendar mark for Meetings folders. Folder tint by audience on top. Folder
   rows show item count.
2. **Folder band at the root of each space**, cards with name, count, audience
   glyph and star (the reference screenshot), files below. Google's 2024 Home
   does the same: folders above files.
3. **Location everywhere it is ambiguous**: a Location column in search, recent,
   starred and trash; "Reveal in Drive" on every document page and in ⌘K
   results; breadcrumb crumbs stay clickable. Location lists viewable
   ancestors only; when the root is not viewable it reads "Shared with me ▸ …"
   and never names the Hiring or Mentorship root, and the page title is never
   built from a scope the viewer cannot enter (`driveFolderCrumbs` already
   collapses unviewable ancestors this way).
4. **Toasts that name the folder** with Open and Undo, for create, move, file.
5. **Drive Home**: Recent, Starred, and "For upcoming meetings" (notebooks whose
   series has an occurrence in the next 7 days; we own the calendar, so this is
   one query).
6. **Tags as color dots** next to names, and tag filters in the sidebar.
7. Later: per-user folder colors on top of audience tint, Activity view, Smart
   folders.

### F2. One folder picker

Today: `DestinationPicker` (Drive hub, project hub, meeting-note fields) and
`MoveToDialog` (document editor, project hub) wrapping it, fed by two data paths.
The hub builds rows from its loaded scopes (every space); the other two fetch
`/api/move-destinations`, which returns Lab folders the caller can edit (Core
folders included for Core, unlabeled under "Lab-wide") and projects. Education
and My Drive are unreachable from inside a doc.

- One `FolderPicker` built on the `DestinationPicker` body. One endpoint
  returning every space the viewer can write to, each folder with `folderType`,
  audience summary and item count.
- Modes: single (move), multi with a primary (file-in), `folderType` filter.
- Server-side search over title and path, not a full-tree preload on open.
- Rows: folder glyph by type, audience glyph, count, path.
- Recent destinations at the top. Create folder inline when nothing matches.
- Multi mode: chips above the list, first chip primary by default, click the
  marker to change. Confirm and toast name the primary.
- `MoveToDialog` retired; its move-and-confirm logic becomes a hook.

### G. Full CRUD matrix

Every row needs a route, a UI entry and an MCP tool.

| Object | Create | Read | Update | Delete / detach |
|---|---|---|---|---|
| Note | from event, post-hoc, one-tap, standalone in Drive | tab, Drive, meeting page | rename, move to another notebook, re-attach to another occurrence or meeting, detach (becomes plain doc) | trash (frees the occurrence slot), purge |
| Notebook | new from create flow, New menu in Drive, "convert doc to notebook" | one Drive item, tab rail | rename, move, set template, set default for a series, merge into another notebook (Fellow's primitive), reorder tabs by date only | trash with its tabs, or dissolve (tabs become docs) |
| Series ↔ notebook | set at create | meeting page shows notebook | change default notebook, future-only or move all | unset |
| Event | create, track Google event | detail page | edit schedule and roster, **plus** set/unset project, set/unset Core, Core-allowed cancel in MCP | cancel this / following / all; cancelling a series offers to trash empty notes |
| Shortcut | "Add shortcut to…", auto for Core check-ins | row with badge | move, rename label | delete row only |

## 4. Decisions

Settled 2026-10-12 and 10-13:

1. **Hiring at root**: yes. Access is the folder's own sharing, user-editable,
   Core only by default.
2. **Mentorship at root**: migrate mentor notes to Pages (A2).
3. **Single-note notebook**: always a notebook, rail hidden at one tab.
4. **Core check-in pointer**: one shortcut per notebook.
5. **Who can add to a notebook**: anyone who can edit it.
6. **"Shared" under My Drive**: a hand-made folder, not a feature. The Shared
   with me space (E) replaces the need for it.
7. **Multi-select file-in** with an explicit primary; new notebook, shortcut
   and Meetings-folder glyphs; one `FolderPicker`.
8. **Folder tint**: audience meaning. The folder glyph is tinted by who can see
   it (only you, project or group, lab-wide), so the folder band reads as an
   access map with no hover. No personal colors.
9. **Mentee access**: none. Mentees cannot see the Mentorship drive; mentors
   read all pair notebooks, the author and Core edit, as today.
10. **Project documents stay lab-readable**, meeting notes included. The Core
    check-in's Core grant is redundant for reading and is kept only so the
    shortcut contract has no special case.
11. **Roots hardcoded, everything below free**: roots are runtime-created real
    folders, never user-bound; no auto-created subfolders anywhere; receivers
    are folder-declared, optional, and must live under their root;
    `ProcessFolderBinding` deleted without backfill once the receiver flag is
    on in prod. Binding direction is folder-declared, not process-declared.

12. **Files inherit their folder** (10-13): the communal default in
    `canViewFile`/`canEditFile` goes. A file's audience is its containing
    folder's audience, computed as for docs; a loose file at a space root takes
    the space's base rule (General = lab-wide, project = project base). Built
    in phase 0.

## 5. Sequencing (revised after review)

Each phase ships behind one flag. Order chosen so no phase builds on a column
that a later phase drops.

0. **Access prerequisites** (behaviour change, small PRs, no UI):
   - Carry `parentPageId`, `scopeKind`, `scopeGroupId`, `scopePermission` into
     the document loader (`documents.$pageId.tsx:128`), the collab `doc:` and
     `whiteboard:` branches (`collabAuth.ts:152`), the notebook tab rows, and
     `visibleLabDocFilter`. Test: a non-Core member of the governing group can
     open a doc under a Group-scoped Lab folder; a non-member cannot.
   - Fix the two #2001 regressions by passing the notebook's parent, not the
     notebook, as `noteLocation` (`scheduled-meeting.ts:893`).
   - Files inherit their folder (decision 12): `canViewFile`/`canEditFile`
     resolve through the containing folder's page access for every file, and
     the file API route gets the same non-member and partner gate as the page.
1. **Roots and columns**, in three steps because no filer is flag-gated today
   and the moment a filer changes, prod filing changes:
   - **1a** columns (`PageKind.Notebook` backfilled from `notebookKey`,
     `folderType`, `processType`/`processId`, `ProcessType.Mentorship`,
     `ScheduledMeeting.notebookId` backfilled from each series' latest note's
     parent, `Form.templateKey`), `ensureRoot`, the Core and Hiring reparent,
     the root guards (cannot trash, cannot nest, `setFolderScope` keeps Group
     ⊇ Core), the `mentors` group. Filers untouched, still reading bindings.
   - **1b** `FolderPicker` in single mode with the `folderType` filter (F2;
     multi mode comes in phase 4), the receiver UI (folder settings "This
     folder receives" and the process settings page over one write, both on
     the picker), and the filer switch to receiver-else-root, flag-gated with
     bindings as the off state.
   - **1c** drop `ProcessFolderBinding`, its four settings surfaces and nav
     rows, and `notebookKey`, once the flag is on in prod.
2. **See the filesystem**: glyphs by kind and folder type, counts, folder band,
   audience summary on rows and details (kind and count for everyone, names
   for managers), inherited block in Share, Location column, Reveal in Drive,
   filing toasts, Shared with me space. Hiring and Mentorship spaces appear
   here because their roots exist from 1a and space visibility follows root
   sharing.
3. **Notebooks first-class**: create flow with the notebook picker, tab rail
   controls, note and notebook CRUD, attendance re-keyed off `meetingType`,
   types removed from create surfaces, MCP tools.
4. **Shortcuts**: `Shortcut` kind, multi-select file-in with primary and the
   grant contract, Also in / Original in details.
5. **Mentorship migration** (A2) and Drive Home.

**Shipped (2026-10-13), all behind flags or additive:**

- Phase 0: #2122 (note location after notebooks), #2123 (scope on open, files
  inherit folder).
- Phase 1a: #2124 (mentors group), #2125 (columns and backfills), #2126
  (roots, guards, reparent job).
- Phase 1b: #2128 (FolderPicker and destinations endpoint), #2129 (receivers
  and the flagged filer switch, flag `drive-receivers`), #2132 (receiver
  settings UI).
- Phase 2: #2130 (audience summary), #2131 (Shared with me, Reveal in Drive,
  filing toasts), #2133 (glyphs, tint, counts, folder band, Location column),
  #2140 (Drive Home, flag `drive-home`), #2141 (tags as color dots, open).
- Phase 3: #2134 (notebook CRUD server, attendance predicate), #2137 (create
  flow, tab rail, convert to notebook).
- Phase 4: #2135 (shortcuts, grant contract, Core check-in rule), #2139
  (multi-select file-in, shortcut rows and details).
- Phase 5: #2136 (mentor notes into per-pair notebooks).

**Operator steps still needed:** run `drive-roots-reparent` once on prod (Admin
→ Jobs), turn on `drive-receivers` (filing switches to receiver-else-root) and
then run phase 1c (drop `ProcessFolderBinding`, `notebookKey`, the
`DriveFolderBindings` surfaces), run `mentor-notes-to-notebooks` until it
reports zero remaining, turn on `drive-home`. No browser pass has been done on
any of this; a screenshot review of the Drive and the create flow should come
before the flags flip. Phase 1c is draft PR #2143 and must wait for the
`drive-receivers` flag to be on in prod.

## 6. Review findings and resolutions (Fable, 2026-10-12)

Adversarial review of this spec against the code. Blockers and should-fixes
with what the spec now says. Nits folded in silently.

**Access**

- **Scope cascade is skipped on open** (blocker, confirmed). The document route
  and the collab socket build the page shape by hand without the scope fields,
  so a Group-scoped folder is enforced only in Drive listings. Invisible today
  because the only scoped group is Core, which passes the Lab rule anyway. Any
  non-Core group scope (Hiring, mentorship) breaks on open. Resolution: phase 0.
- **`hiring` group is too wide for a default** (blocker). It is Core plus anyone
  who ever held a domain-lead, reviewer or interviewer row, with no cycle
  filter, alumni included. Resolution: Hiring root is Core only (decided).
- **Auto-grant authority and ownership** (blocker). Resolution, the grant
  contract: creating a shortcut needs `canEdit(folder)` and
  `canManageSharing(target)`; if the second fails, the shortcut is created with
  no grant and shows the "no access" state. The shortcut row records the share
  it created (`grantShareId`, nullable, SetNull) and chip removal deletes only
  that. The grant principal per destination: Group-scoped folder = that group;
  unscoped Project folder = the project group; Private = the folder creator as
  a User share; Education = the offering group; Member = not a destination.
  The "toggle lab-wide link access" branch is dropped: an unscoped Lab folder
  grants nothing, because Lab pages already default to lab-wide.
- **Core check-in primary is lab-readable** (should-fix, see section 1).
  Accepted: all project documents are lab-readable by design (decided 10-12).
- **Audience summary leaks names** (should-fix). Resolution: names and avatars
  only for viewers with `canManageSharing`; everyone else sees kind and count
  ("Core + 2 people"). Group sizes resolve in the Share dialog, not the row.
- **Shortcut to a personal note** (should-fix). Resolution: a shortcut row whose
  target the viewer cannot open renders as "Shortcut (no access)" with no title.
- **Folder re-scope** (nit). Grants are snapshots; re-scoping a folder does not
  retarget them. Share dialog says so on shortcut-created grants.

**Data model**

- **`MentorshipPair` ids churn on every finalize** (blocker): `derivePairings`
  deletes and recreates auto pairs, and the table has no unique key.
  Resolution: no `MentorshipPair.notebookId`. The pair notebook is found or
  created by the tuple (mentor, mentee, project, term, domain), and `MentorNote`
  gains `pageId`. The notebook inherits the root scope (mentors plus Core, View); edit
  is granted by explicit per-page shares (A2, superseding this review's
  "author edits as creator", which the engine does not produce). No per-pair
  dynamic group, which would add a `GroupDefinition` row per pair to every
  group picker and every navigation.
- **`meetingType` gates attendance** (blocker). Manual attendance (`attendance`
  route, `mark_meeting_attendance` MCP, `tracksAttendance`, roster seeding in
  `setMeetingProject`, `get_attendance_overview` labels) returns 403 when the
  type is null. Resolution: the predicate becomes "has a notebook, or
  `attendanceMode` is SelfCheckIn, or has participants", applied at those five
  sites before the type leaves the create surfaces.
- **Re-attach collisions**: `@@unique([meetingNoteId, meetingOccurrenceStart])`
  refuses a second note for the same occurrence. Resolution: re-attach refuses
  if the occurrence already has a live note; detach nulls both columns together.
  A notebook's workspace is its tabs' workspace, so mixing series across
  workspaces changes who can read the moved note; the picker confirms that.
- **`folderType` needs `Root`, `ProcessType` needs `Mentorship`**. Added. The
  Hiring root uses `HiringCycle` with the existing `hiring` sentinel id.
- **One folder can hold several bindings today** (`setBinding` never checks).
  Moot: bindings are deleted without backfill (decision 11).
- **Folder-only nesting is enforced in eight places** (move route, project and
  education document create, LMS, three MCP tools, lab-documents). All must
  accept a Notebook parent for tabs. The subtree move and the document route
  detect notebooks by `notebookKey`; phase 1 switches them to `kind`.
- **Trash**: trashing a notebook archives its subtree (`collectSubtree`).
  "Original in trash" derives from `target.archivedAt` at read time; the
  cascade on `targetPageId` fires only on purge, and a purged target removes
  its shortcuts silently. Accepted and documented.
- `defaultMeetingNoteFor` and its three readers go with the types.

**Migration**

- **Rooms cannot be "pointed at"**: a page body is always `doc:<pageId>:body`.
  Resolution: rename `CollabDocument` and `CollabDocumentVersion` rows from
  `mentorNote:<id>:body`; materialise a room from `contentJson` for notes never
  opened in collab; switch the three `contentJson` readers (read view, mentor
  note API, MCP `get_mentor_note`) to `readDocAsBlocks` in the same PR.
- **Mentee access**: unchanged from today. Mentees never see the Mentorship
  drive; every mentor reads; author and Core edit (decided 10-12).
- **Collapsing Team/Partner folders**: both survive as plain folders with no
  type; existing per-type-per-term notebooks keep their titles and places.

**UX**

- **Undo after filing** = trash the note; trash the notebook if this action
  created it and it is now empty; delete shortcuts this action created and
  their recorded grants; leave the series default alone. Move undo = inverse
  move with the pre-move parent captured client-side.
- **Shared with me** = PageShare rows for the user or any of their groups,
  then `getPageAccessBulk` with shares stripped, keep pages whose base view is
  false. Group shares count. Core sees nothing here for Lab or project pages;
  the space says so instead of rendering empty.
- **Single-tab notebook** needs a header affordance ("In notebook X", Add tab)
  or nobody discovers "add to existing".
- Any project member can file a Core meeting into a project notebook. Accepted.

**Performance**

- `findGoverningScope` walks ancestors one query per level per page with no
  memo, and the Drive loads every space on every visit. Scoped roots multiply
  that. Resolution: the Drive already holds the whole workspace in memory;
  compute the governing scope in-process from the loaded rows and pass a
  `governingByPageId` map into `getPageAccessBulk`. The audience summary rides
  the same map. People-level detail loads on hover, never in the loader.

## 7. Second review (Fable, 2026-10-13) on the roots-and-receivers model

Verified against the code; resolutions are written into the sections above.

- **Mentorship edit model was not producible** (blocker, confirmed): the
  creator softener grants the scope's permission, Core does not bypass a
  governing scope, tabs copy only workspace and link access. Resolved by
  explicit per-tab shares (A2). "Mentors" was not a group; `mentors` dynamic
  kind added (A2).
- **There is no Core root to re-type** (blocker, confirmed): Core is a filter
  and every bound folder sits at Lab top level. Resolved by the phase 1a
  reparent plus the scope-derivation rewrite (A).
- **Roots cannot be created by a migration** (blocker, confirmed): CI resets
  and seeds, so the Core group does not exist at migrate time. Resolved by
  `ensureRoot` at runtime with a partial unique index (A).
- **Template identity keyed on folder** (should-fix): a receiver switch would
  fork a blank template. Resolved by `Form.templateKey` (B2).
- **No filer for Rubrics or EmailTemplates receivers**: dropped from the enum.
- **General meetings had no root**: General is the Lab root; one Lab-level
  Meetings receiver allowed (B2).
- **Receiver lifecycle** (trash, restore, move, MCP nesting): defined (B2).
- **Project delete would 409 on every opened project** once bindings go:
  count only non-empty content (B2).
- **Phase 1 was not flag-safe**: split into 1a, 1b, 1c (section 5).
- **Location for unviewable ancestors**: defined (F.3).
- **Space visibility must follow the root's sharing**, not `RoleFlags` (A).

## 8. Follow-up (2026-10-13 feedback): Core by placement, filing links, suggestions

Status: planned, not built. Decided with Kiran on 2026-10-13.

### 8.1 Core is a placement, not a flag

Today `ScheduledMeeting.isCoreMeeting` is written by a Core-only toggle in the
create modal (auto-on when the Core group is invited) and by the week-grid
popover. Its consumers: the notebook identity bucket (`core` vs `general` in
`meeting-notebook.ts`), the default filing folder (`resolveArtifactFiling`),
the Core shortcut rule (unreachable from the UI, which always sends a notebook
choice), the Attendance page scope label, the "Core" pill on the meeting page,
and the MCP `schedule_meeting` / `get_meeting` tools. Attendance tracking and
the Core hub do not read it.

New rule: **a meeting is Core when its notebook, or a shortcut to it, lives
under Core's Meetings receiver (or the Core root).** `isCoreMeeting(meeting)`
becomes a server predicate over `placementsOf(notebookId)`; the column is
removed in two steps.

1. PR A: predicate + consumers derive from placements; backfill job
   `core-flag-to-shortcuts` adds a Core shortcut (with the Core grant) for
   every flagged meeting whose notebook is not already under Core. The column
   stays but nothing writes it except the backfill's inverse (so prod can be
   checked side by side).
2. PR B: drop `isCoreMeeting` (data-losing, flagged in the PR), remove the
   popover toggle, `set-meeting-core` intent, `SetMeetingCoreSchema`, and the
   MCP input. Attendance labels and the Core pill read the predicate.

Inviting the Core group no longer forces anything; it feeds the suggestion.
The notebook identity bucket collapses to `project:<id>` or `general` (the
`core` bucket only served MCP and legacy callers).

### 8.2 Create modal: no toggles, one Notes block

The three toggles (Core meeting, Create meeting note, Create whiteboard) are
replaced by one block:

- **Notes**: Radio group "No note", "New notebook", "Add to existing
  notebook". "Existing" opens the NotebookPicker as today.
- **Also start a whiteboard**: Checkbox, shown when a note is chosen; filed in
  the same primary folder.
- **Filed in**: an inline chip list using `picker-multi.ts`. The first pick
  carries a **Primary** badge; later picks carry **Link**. Clicking a Link
  badge makes it primary. "Add a place…" opens FolderPicker in multi mode on
  top of the modal (it portals). Removing the primary promotes the next chip.
- Submit: the notebook is created at the primary (`createNotebook`), then
  `placePage` adds a shortcut with grant at each link. The payload gains
  `notebook.links: Dest[]`.
- The Add-note modal for an existing meeting uses the same block. The week-grid
  popover's Core toggle becomes "File in…" on the notebook (FileInPicker).

### 8.3 Recommended filing (no AI)

`suggestFiling({ attendeeIds, groups, title })` is a pure client function over
data the modal already loads (`GroupOption { id, name, memberIds, projectId,
systemKey }` plus the resolved participant ids).

Candidates: each project group, the Core group, each offering group.
Score per candidate = share of attendees on that roster (0..1), plus 0.5 when
the project/offering name (4+ chars) appears in the title case-insensitively,
plus 0.3 when the title contains "core" for the Core candidate. Shown when
score ≥ 0.5 and the roster overlap is at least two people, or on a title match
alone. Top two, ordered by score.

UI: chips above "Filed in": "Suggested: Project X · 3 of 4 attendees". One
click adds the destination (that candidate's Meetings receiver, else its
root) as primary when nothing is chosen, else as a link. Never auto-applied;
today's single-project prefill stays. The Add-note modal gets the attendees
from a small `GET /api/scheduled-meetings/:id/attendees` so it can run the
same function.

### 8.4 Drive Home

List rows modeled on Google Drive Home, not cards: glyph, title, reason
column, location. Upcoming = one row per meeting series the viewer organizes
or attends (Core gets no wider view), titled by the meeting, reason "in 2
hours · <notebook>". Recent rows show "Opened 17 minutes ago" and a one-line
truncated location. Starred section removed (the bookmarks bar covers it).
Shipped in the 2026-10-13 feedback PR.

### 8.5 Sequencing

1. Feedback PR (this round): rail fixes, columns selection, bulk bar, glyph
   tooltips, lab audience glyph, toasts + ⌘Z, optimistic moves, loader and
   move perf, Drive Home rows.
2. PR A (8.1 predicate + backfill, 8.2 modal block, 8.3 suggestions).
3. PR B (drop the column) after a prod check that the Attendance labels and
   Core pills match the old flag.
