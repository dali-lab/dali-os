# Meeting-note filing

Status: decided 2026-10-14 after a design review (one Fable design pass, then UI/UX and dev reviewers). Not built. Every feature flag is assumed on; legacy paths are out of scope. Line references are to staging as of #2155.

## Goals

Intuitively create meeting notes, sequence them in notebooks, and find them later. Everyone in a meeting can edit the note and find it in their Drive. Ask the organizer as little as possible without leaving them unsure where the note lives or how to change it. Full lifecycle support: create, change location, attach an existing document, delete and restore, sharing changes.

## Decisions

| Question | Decision |
|---|---|
| Unit of filing | The notebook. Folders never appear in the meeting form. |
| Which space | From the invite: a project group names its project, the Core group names Core, otherwise Lab. Shown as one line, switchable. Never derived from a folder. The option text says it also sets the meeting's project. |
| Default notebook | Series notebook, else the notebook last used by the same set of invited groups, else a new one named after the meeting. No "most recent in space" fallback and no title heuristics. |
| Where a new notebook lands | The space's receiver folder, else a per-space Meetings root. Many folders per space may be marked; no folder is bound to a group. |
| Attendee access | Everyone on the meeting can write in the notebook's tabs. Notebook structure (trash, dissolve, merge, detach, remove tab) stays with role, folder access, or the organizer. |
| How the grant is made | One Group share on each invited group, plus one User share per individually invited person and the organizer, each skipped when base access already gives edit. Grants are recorded per meeting in a join table. |
| Uninviting | Removes that meeting's grant; the share row goes only when no other live grant points at it. Role and folder access are untouched. |
| Cancelling | Touches no documents, pointers, or shares. |
| Edit event | Shows the Space and Notebook lines. A change applies to future occurrences only; existing notes stay where they are. |
| Attach existing document | From the notebook rail, as today. Not in the meeting form. |
| Project drives | Browsable by anyone in the lab; members edit. Folders that need privacy are scoped explicitly. |
| Partners | Through the existing partner share path and portal. |
| Finding notes | No new Drive section. Project notebooks are browsable; Core notebooks reach non-Core attendees through Shared with me; search filters by view access. |

## The form

One block under "Add to this meeting". Replaces the Notebook well, the new/existing segmented control, the Location and Shortcuts lists, "Add a place…", and the suggestion chips (`MeetingNoteFields.tsx:291-391`, `FiledInChips.tsx`).

1. **Space.** A `Select` labelled Space, preselected from the invite. Options carry their consequence: "Project Alpha · Also sets the meeting's project. Members edit; the lab can view." / "Core · Core edits. Invitees get edit." / "Lab · Everyone in the lab can open it." One InfoTip on the label: "Everyone invited can edit the note, whichever space it files in." Two project groups invited gives two options; the organizer picks.
2. **Notebook.** One line with a Change link. Existing: "Weekly sync · 4 notes · Project Alpha / Meetings [Change]". New: "New notebook “Weekly sync” · Project Alpha / Meetings [Change]". When a Core cross-link will be made: "· also linked from Project Alpha". Change opens the notebook picker scoped to the space with "New notebook…" as the first row of the list. New notebook takes a title prefilled from the meeting title and the space's template.
3. Nothing else.

Whiteboards file beside the notebook. A whiteboard without a note files at the space's receiver folder.

After submit, the toast reads "Note filed in Weekly sync · Project Alpha" with Open and Undo; Undo reports "Note and its empty notebook removed" when it trashed the notebook. The durable status line keeps the note: "Meeting created. Note in Weekly sync (Project Alpha). Open." (`CreateEventModal.tsx:934-947`, `useFiledNoteToast.ts:40`).

Edit event shows the same two lines. Changing either moves future occurrences only; the confirm says so.

## Default notebook, in order

1. `ScheduledMeeting.notebookId` when the meeting already has a series notebook.
2. The notebook most recently used by a meeting whose audience key matches. The audience key becomes the sorted set of invited group ids whenever one or more groups are invited, regardless of individually added people; the people hash stays for meetings with no group.
3. New notebook named after the meeting.

The organizer always sees which one was chosen and can change it in one click.

## Where the note says it lives

- **Note page.** A location line under the title using `LocationLink`: "Project Alpha / Meetings / Weekly sync · Oct 14". An InfoTip for meeting-granted editors: "You can edit because you're on this meeting." Replaces the "In notebook X" chip (`NotebookRail.tsx:480`, `documents.$pageId.tsx:77` hides breadcrumbs).
- **Tab menu** gains "Move to notebook…", so a wrong-notebook fix happens where the user noticed it. "Remove from notebook" keeps its copy.
- **Meeting page.** "Change notebook" on a one-off skips the future/all choice and confirms "Move this note to {title}?". On a series it keeps "Future meetings only / All meetings".
- **Drive.** Meeting folders draw a colored calendar mark in every folder glyph (rows, tiles, columns, picker); the body tint keeps meaning audience. Glyph hover: "Meetings folder · new notebooks file here". Details pane "Receives" reads "New meeting notebooks for Project Alpha". A notebook's details pane says "Notebook · 4 tabs" (not "Document") and lists the meetings that file into it.
- **Share dialog.** Meeting grants render like shortcut grants (`ShareDialog.tsx:375-383`): second line "via meeting Weekly sync", role locked, not removable there, title "Added because they're on the meeting. Uninviting removes it." Audience line: "Project team · 6 meeting attendees can edit."

## Access

- **Notebook shares reach tabs.** In `shareAndLinkGrant` and the bulk path (`pageAccess.server.ts:163, 562`), when a page's parent is a Notebook, the parent's shares count for the page. `PAGE_ACCESS_SELECT` gains the parent's id and kind. Link access is unaffected. This also repairs the Core cross-link, which grants on the notebook only.
- **Meeting-granted edit is tab-level.** The rail's structure controls (`NotebookRail.tsx:86, 463`) gate on base edit or organizer, not on the resolved edit that a meeting grant produces. Access resolution exposes which it is.
- **Grant sync.** One function, `syncMeetingShares(meetingId)`, one query per notebook. Called from meeting create, add-note-later, attach existing document, set-series-notebook, merge notebooks, roster edits (this, following, all), and tracked external events. It upserts the grants the meeting justifies, never downgrades a share, skips people and groups with base edit, and removes a grant the meeting no longer justifies, deleting the share row only when no live grant remains and the share was meeting-created. Shortcut grant deletion (`shortcuts.server.ts:361`) checks the table before deleting a row it may share.
- **Add-note gate** opens to the roster: organizer, Core, or participant, once the series has a notebook or a previous note (`scheduled-meeting.ts:1191-1207` today blocks participants on a series with a notebook but no notes).
- **Project drives** list for every lab member (`drive-hub.server.ts:11-16`); project roots keep members as editors. Marking a folder as a receiver does not change its sharing.
- **Receivers stay in their space's root.** A Meetings receiver outside the process's own tree is refused.
- **Search** filters results by view access (`search.server.ts:260-265` has none today).

## Lifecycle

| Operation | Behaviour |
|---|---|
| Create at meeting creation | As the form says. Grant sync runs. |
| Add a note later | Meeting page and rail, same defaults, grant sync runs. MCP `schedule_meeting` gains a `notebook` input and loses `noteLocation`. |
| Recurring occurrences | One tab per occurrence, as today. |
| "This and following" split | The new series carries `notebook: { existingId }` and does not mint a duplicate note. Notes dated after the cut stay attached to the series they were written under. |
| Change location | Tab: "Move to notebook…" in the tab menu and the existing rail move; an emptied notebook is trashed and the series pointer is kept (today `moveIntoNotebook` trashes without touching the pointer). Notebook: Drive move as today; moving a project notebook to Lab widens access to the lab, which the confirm states. |
| Attach existing document | Rail only, as today (organizer or Core, FreeForm). Grant sync runs on attach. Detach leaves grants on the old notebook. |
| Trash a note | The meeting offers a fresh note; the confirm says so. A trashed note no longer blocks re-creating the occurrence's note (today it does, `attachMeetingNote:1183`). |
| Trash a notebook | Confirm: "The notebook and all of its notes go to Trash. Meetings that file here will start a new notebook; people invited to those meetings lose access." The series pointer is kept through trash so restore re-attaches (today `trashNotebook:478` nulls it and restore does not undo it). |
| Restore | Tabs and pointer come back. |
| Permanent delete | Blocked while children exist, as today; grants cascade with the share rows. |
| Cancel occurrence or series | Nothing changes on documents, pointers, or shares. |
| Uninvite | Grant removed per the sync rule. |

## Schema

- New table `MeetingShareGrant`: id, `scheduledMeetingId` (cascade on delete), `pageId` (the notebook), `principalType` and `principalId` (group or user), `pageShareId` (cascade), `createdShare` boolean, `createdAt`. Unique on meeting, page, principal. Indexes on (pageId, principal) and on pageShareId.
- No new column on `PageShare`.
- Project roots: no enum change; the root key gains `project:<id>` in code, reusing `folderType = Root` with `processType = Project`. Confirm the partial unique index covers it.
- Hint removal: a data migration nulling `folderType = Meetings` on rows with no `processType`.
- `trashNotebook` stops nulling `ScheduledMeeting.notebookId`; reads already skip archived notebooks.

## Server

- `NotebookChoice` becomes `{ existingId } | { title, templatePageId }`. `location`, `links`, `noteLocation`, move-on-file and declined-move go.
- The meeting's `projectId` comes from the chosen space. Meeting type derives as today: project space reads as Team, else Other named after the notebook. `projectIdOf` goes.
- The notebook picker query filters by the space's workspace instead of scanning the 300 most recently updated notebooks lab-wide.

## Removed

The places model in `meeting-note.ts` and its helpers, `FiledInChips`, `suggest-filing.ts`, the new/existing toggle, `projectIdOf`, the hint folder type and `setFolderHint`, move-on-file, whiteboard-only location, the project member gate on project drives, the organizer-or-Core gate on adding a note.

## Kept

Receiver slots and their eligibility rules, series notebooks, notebook templates per space, the automatic Core cross-link for a Core meeting about a project, notebook identity as the fallback for notes added later to a meeting with no notebook, Drive Home Upcoming, attach and detach from the rail.

## PRs, in order

1. **Notebook shares reach tabs.** Access resolution plus `PAGE_ACCESS_SELECT`. Tests: tab inherits View and Edit from a notebook share; bulk equals single; link access unaffected; Core cross-link reaches tabs.
2. **Search by view access.** Tests: member-workspace note hidden, Core-folder doc hidden from non-Core, project page visible to the lab.
3. **Grant table and `syncMeetingShares`.** Called from every path listed under Access. Tests: upsert, never downgrades, skips base edit, group share for group invites, removal only when no live grant remains, shortcut collision, cancel leaves grants.
4. **Tab-level meeting edit.** Rail structure controls gate on base edit or organizer. Tests per control.
5. **Add-note gate follows the roster.** Tests for a series with a notebook and no notes.
6. **Splits carry the notebook; pointer survives trash; trashed note no longer blocks re-creation.** Tests on split, trash, restore.
7. **Project drives lab-wide, project root key, in-root receiver rule.** Tests on project workspace listing and `isUnderRoot`.
8. **Form and payload.** Space and Notebook lines on create and edit, slim choice, history default with the group-set audience key, picker by space, MCP input, toast and status copy, note location line, "Move to notebook…", one-off change-notebook confirm. Tests for default order and the edit-event future-only rule.
9. **Hint removal, colored mark, details-pane and Share-dialog copy.**

PRs 1 through 7 change no UI the organizer sees and can ship ahead of the form.

## Risks

- Opening project drives exposes every file in project folders to the lab, not only notebooks. Audit for folders that relied on the drive gate before flipping.
- A Group share on the invited group means later joiners gain access and leavers lose it. Accepted.
- Changing the audience key affects only new one-offs; existing meetings keep their series notebook.
- The grant sync runs on every roster edit of a series; it must stay at one query per notebook.
