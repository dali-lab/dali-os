# Meeting notes model (PR 3 of meeting transcription)

Status: design rev 2, Oct 10 2026, after review. Builds on
`meeting-transcription.md` (recording, Modal transcription, transcript in the
note). This spec covers what happens to the words once they exist: how they
become notes people actually use.

## The idea, in one paragraph

The note page is where attendees type during the meeting, as today. When the
transcript lands, **Enhance** fills the note in using the typed notes as the
skeleton: every heading and bullet the author wrote stays, in their words and
order, and gets expanded from what was said. Decisions and action items the
author missed are added under their own headings and marked as added. Every
added or expanded sentence carries a small timestamp chip that opens the
transcript at that moment. Action items become Tasks on the meeting's project
with one click. If the transcript sits unused, the recorder gets one nudge. This
is the Granola model inside DALI OS, with the lab's roster, projects and tasks
wired in rather than bolted on.

## What exists today

- `POST /api/ai/meeting-notes` turns the transcript into a fixed Summary /
  Decisions / Action items markdown block, appended to the note along with the
  transcript under a toggle. Nothing is stored; the author's own notes are
  ignored.
- The transcript lives on `MeetingRecording.lines` with `at`/`end` seconds per
  line and roster-renamed speakers. A read-only view exists at
  `?transcript=<id>`.
- Meeting notes are created empty by `attachMeetingNote`. No template.
- Tasks exist per project with assignee, due date, checklist, description doc.
- Jobs: `meeting-reminders` (before), `meeting-record-prompts` (at start).
  Nothing after a meeting.
- MCP: `get_meeting` has no transcript or recording fields.
- The only server-side doc write, `replaceCollabDocContent`, rewrites the whole
  fragment. Named versions exist (`CollabDocumentVersion.label`).

## Design

### 1. Templates seeded into new notes

A meeting note starts with structure so there is something to anchor to.

- Lab defaults per meeting type (Team, Partner, General), editable in Admin ▸
  Templates as ordinary page templates tagged with a `meetingType`. Reuses the
  existing page-template system (#1402); no new model.
- A project may pick its own: `Project.meetingNoteTemplateId` (a field, not a
  join table). Project ▸ Settings ▸ Meetings.
- Suggested Team default: `## Agenda`, `## Notes`, `## Decisions`,
  `## Action items`. Partner adds `## For the partner`.
- `attachMeetingNote` copies the template body into the new page and records
  `Page.seededTemplateHash` (hash of the normalized body it wrote). "Still the
  untouched template" is then a deterministic comparison, and stays correct
  after an admin edits the template. Existing notes are untouched.
- The Record start sheet gains one line so people learn the model on first
  use: "Type rough notes during the meeting; Enhance fills them in afterwards."

### 2. Enhance: typed notes as anchors

Replaces the current Write notes button once a recording is Done.

**Input.** The note's blocks as markdown with each top-level block's id (from
the enhancer's own editor, not a server read), the transcript with `at`
seconds per line, the roster (attendance rows plus organizer), the meeting
type, the occurrence date.

**Model.** Claude Sonnet 5, through `resolveAiProvider()` as today. Same
per-user burst and daily caps as `api/ai/meeting-notes`. No model toggle.

**Output.** Structured JSON keyed to the existing blocks, so it can be merged
rather than pasted:

```json
{
  "blocks": [
    { "id": "b1", "op": "keep" },
    { "id": "b2", "op": "expand", "text": "Scope change: drop the admin dashboard from v1; partner agreed; revisit in January.", "cites": [812.4, 840.0] },
    { "op": "insert", "after": "b2", "type": "bullet", "text": "...", "cites": [901.2] },
    { "op": "insert", "after": "b9", "type": "heading", "text": "Decisions", "added": true }
  ],
  "actionItems": [
    { "text": "Send the partner the revised scope", "ownerName": "Ada L", "due": "2026-10-17", "dueSource": "by Friday", "cites": [1203.0] }
  ]
}
```

Prompt rules: keep every existing block, in order, in the author's wording;
expand a block only with what the transcript supports; add `Decisions` and
`Action items` sections if missing; never invent names, dates or numbers;
every expanded or inserted block that uses transcript content cites the
transcript times it drew from; owners are roster names only, never ids;
relative dates ("by Friday") are resolved against the occurrence date and
returned with the phrase they came from.

**Server verification before anything reaches the sheet.** Every cite must
match a transcript line within 2 s or the cite is dropped; an inserted block
with no surviving cite, or whose text shares no content words with its cited
lines, is dropped and counted. Owner names are matched to roster user ids on
the server; unmatched names stay as text and the sheet says "not on the
roster". Prompt rules alone are not a guard.

**No typed notes.** A note that is empty or still the seeded template is the
same flow with the template headings as the skeleton. A heading the transcript
does not support (usually Agenda) is left empty and hidden on apply; Decisions
and Action items are always attempted. This covers teams who record and
summarise without typing; a "Summary" template with three headings reproduces
today's flat output. The button reads **Write notes** in this state and
**Enhance notes** once someone has typed. Same endpoint, same sheet.

**Storage.** `MeetingRecording.notes Json?` holds the last verified result,
with `enhancedAt` and `enhancedBy` set when applied. Fields on the existing
row; the result is a function of (recording, note at time T) and dies with the
recording under the janitor. The row is never cleared locally after apply any
more; the Done panel reads "Enhanced Oct 10, 2:14 PM by Ada" with Re-run.

**Applying, in a shared doc.** Whole-body Replace is out: several people type
in these notes, generation takes 10 to 20 s, and the sheet may sit open for
minutes. The enhancer's editor applies the result block by block:

- `keep` leaves the block alone.
- `expand` replaces the block's text only if the block's current text still
  equals the snapshot; otherwise the block is left as the live text and the
  expansion is skipped. The sheet shows "3 blocks changed while this ran and
  were left as typed."
- `insert` adds after the named block, or at the end of its section if that
  block is gone.
- The `### Transcript` toggle is found by its heading and reused, never
  appended twice.

A named version "Before enhance" is saved first (existing versions system),
so the whole thing is one click to undo. Because the change goes through the
editor, Yjs attributes it to the person who clicked. A re-run treats the
current text, including earlier enhancements and any hand edits since, as the
new anchors; nothing is overwritten from a stored copy.

Two editors can click Enhance at once. The server refuses the second apply
when `notes` was written after that client's snapshot, and the sheet offers to
reload the preview.

**UX.**
1. When the transcript lands, Enhance runs once automatically into preview
   (no apply), so the sheet is ready the moment someone opens the note or the
   nudge.
2. The Done panel's primary is **Write notes** or **Enhance notes** (see
   above). Insert transcript stays secondary for people who want only that.
3. The sheet shows the merged note read-only with changed and added blocks
   highlighted, citation chips live, the skipped-conflicts count, and the
   action items with owner and due date editable inline. Buttons: **Apply**,
   Cancel.
4. Apply saves the version, merges, and inserts the transcript toggle if it is
   not already there.

### 3. Citation chips

Chips are ordinary BlockNote links, not a new inline node: text `12:34`,
href `/documents/<pageId>?transcript=<recordingId>&at=<seconds>`. The
transcript panel accepts `&at=` and scrolls to the line. Internal
`?transcript=` links render as a compact chip with a hover card showing the
line, through the existing link renderer, so no schema change is needed.

A new inline node was considered and rejected: y-prosemirror deletes content
it cannot decode and Hocuspocus broadcasts the deletion, so one stale client
opening an enhanced note would strip every citation for everyone. Links export
correctly to PDF and Markdown and survive paste.

### 4. Action items into Tasks

Only for project meetings (tasks need a project).

- The sheet lists action items pre-checked with owner (roster match or "not
  on the roster") and due date (resolved relative date shown with its source
  phrase, editable). **Create tasks** creates the checked ones; nothing is
  created silently.
- Created through the existing task service: title = item text, assignee =
  owner, due = date, status Todo, no sprint, description = one line linking the
  note at the cited time. `Task.sourceRecordingId` (nullable field) backlinks
  the recording so "tasks from this meeting" is a query and a re-run never
  creates a duplicate.
- The checklist item in the note gets a `taskMention` inline (extend the
  existing mention spec with a task kind, which is already a schema the clients
  carry) so the note shows live task status. Falls back to a plain link to the
  task if the mention spec change has not reached all clients yet.

### 5. Post-meeting nudge

One event. New job `meeting-notes-nudge`, 5 min interval, idempotent through
`MeetingReminderLog` with a new `kind`.

- Recording Done, not applied, and the note not opened by the recorder since
  Done → notify the recorder once: "Your transcript for {meeting} is ready."
  linking to `?transcript=<id>`. Registry event `meeting.transcript_ready`,
  in-app and desktop banner on by default, email off.

A "no notes yet" nudge to organizers was considered and dropped: with weekly
standups across every project team, most legitimately noteless, it would fire
after nearly every meeting and get the Meetings area muted.

### 6. MCP

- `get_meeting` gains `transcriptAvailable` and `recordings: [{ id, status,
  recordedSeconds, enhancedAt }]`.
- New `get_meeting_transcript({ meetingId | recordingId, occurrenceStart?,
  from?, to? })` returning lines with resolved speaker names, paged at 2,000
  lines. Same audience as the note.
- New `enhance_meeting_notes({ recordingId, apply: boolean })`: preview returns
  the verified JSON; apply runs the same block merge server-side through a
  direct connection, with the same snapshot check.

## Permissions

Enhance, Apply and Create tasks require edit access to the note (same as
Insert today). Chips and the transcript panel follow the note's read audience.
Create tasks additionally requires task-create rights on the project; the
sheet hides it otherwise.

## Privacy

Enhance sends the typed notes and the transcript to the configured AI
provider; today only the transcript goes. The first Enhance per user confirms
that in plain words. Partner-visible exports and the partner portal exclude
the transcript toggle and the citation chips, since a Partner note now
carries verbatim speech. Retention is unchanged: `notes` dies with the row.

## Delivery

Three PRs behind the existing `ai-meeting-notes` flag. No editor schema change
until PR 3, and that one extends a spec every client already carries.

1. **Templates with the seeded hash, the nudge job, MCP read tools.**
2. **Enhance: endpoint with verification, auto-preview, the sheet, client-side
   merge with conflict rule, version snapshot, link chips, `&at=` in the
   transcript panel, enhance lock.**
3. **Action items into Tasks, `Task.sourceRecordingId`, task mention, the
   enhance MCP tool.**

Rough size: PR 1 two days, PR 2 four days, PR 3 two days.

## Decisions (were open questions in rev 1)

1. Apply is an in-place block merge with a saved version, not Replace or
   Append. Append doubles every note; Replace clobbers concurrent typing.
2. Templates: lab defaults per meeting type with a project override.
3. Create tasks always shows the list once, with owner and due editable; no
   silent creation.
4. Nudge the recorder only. The organizer learns through the note.
5. One Sonnet-class model, no Admin toggle. If quality falls short, change the
   constant.

## Compared with the field

Adopts Granola's anchor model and no-notes fallback, Notion's timestamped
sources and "detected" prompt (shipped earlier), and the Notion/Asana
one-click task pattern, and improves on them with verified citations, live
task status in the note, and roster-matched owners. Deliberately skips
transcript chat (MCP covers agent users) and auto-apply (preview is
auto-run, apply stays a human click).
