# Meeting notes model (PR 3 of meeting transcription)

Status: design for review, Oct 10 2026. Builds on `meeting-transcription.md`
(recording, Modal transcription, transcript in the note). This spec covers what
happens to the words once they exist: how they become notes people actually use.

## The idea, in one paragraph

The note page is where attendees type during the meeting, as today. When the
transcript lands, **Enhance** rewrites the note using the typed notes as the
skeleton: every heading and bullet the author wrote stays, in their words and
order, and gets filled in from what was said. Decisions and action items the
author missed are added under their own headings. Every added or expanded
sentence carries a small citation chip that opens the transcript at that
moment. Action items become Tasks on the meeting's project with one click. If
nobody opens the note after the meeting, the recorder gets a nudge. This is the
Granola model, inside DALI OS, with the lab's roster, projects and tasks wired
in rather than bolted on.

## What exists today

- `POST /api/ai/meeting-notes` turns the transcript into a fixed Summary /
  Decisions / Action items markdown block, appended to the note along with the
  transcript under a toggle. Nothing is stored; the author's own notes are
  ignored.
- The transcript lives on `MeetingRecording.lines` with `[mm:ss] Speaker: text`
  lines and roster-renamed speakers. A read-only view exists at
  `?transcript=<id>`.
- Meeting notes are created empty by `attachMeetingNote`. No template.
- Tasks exist per project with assignee, due date, checklist, description doc.
- Jobs: `meeting-reminders` (before), `meeting-record-prompts` (at start).
  Nothing after a meeting.
- MCP: `get_meeting` has no transcript or recording fields.

## Design

### 1. Templates seeded into new notes

A meeting note starts with structure so there is something to anchor to.

- Lab defaults per meeting type (Team, Partner, General), editable in Admin ▸
  Templates as ordinary page templates tagged with a `meetingType`. Reuses the
  existing page-template system (#1402); no new model.
- A project may pick its own template: `Project.meetingNoteTemplateId` (a
  field, not a join table). Project ▸ Settings ▸ Meetings.
- Suggested Team default: `## Agenda`, `## Notes`, `## Decisions`,
  `## Action items`. Partner adds `## For the partner`.
- `attachMeetingNote` copies the template body into the new page. Existing
  notes are untouched.

### 2. Enhance: typed notes as anchors

Replaces the current "Write notes" button once a recording is Done.

**Input.** The note body as markdown (current doc, via `app/collab/read.ts`),
the transcript with a stable index per line, the roster, the meeting type.

**Model.** Claude Sonnet 5 by default (a 1 hour meeting is ~16k input tokens;
Opus is not needed for this), through `resolveAiProvider()` as today. Same
per-user burst and daily caps as `api/ai/meeting-notes`.

**Output.** Structured JSON, not markdown, so it can be rendered into blocks
with citations:

```json
{
  "sections": [
    { "heading": "Agenda", "kept": true, "blocks": [
      { "type": "paragraph", "text": "...", "cites": [12, 13] },
      { "type": "bullet", "text": "...", "cites": [40] }
    ]},
    { "heading": "Decisions", "added": true, "blocks": [...] }
  ],
  "actionItems": [
    { "text": "Send the partner the revised scope", "ownerUserId": "u_…", "ownerName": "Ada L", "due": null, "cites": [88, 89] }
  ]
}
```

Prompt rules: keep every heading the author wrote, in order, in their wording;
keep every bullet, expanding it only with what the transcript supports; add
`Decisions` and `Action items` sections if missing; never invent names, dates
or numbers; every block that uses transcript content cites the line indexes it
drew from; owners must be roster names, matched to user ids server-side.

**No typed notes.** A note that is empty or still the untouched template is
the same flow with the template as the skeleton: each template heading is
filled from the transcript, and a heading the transcript does not support
(usually Agenda) is left empty rather than reconstructed, then hidden on
Replace. Decisions and Action items are the only sections always attempted.
This covers teams who record and summarise without typing; a "Summary"
template with three headings reproduces today's flat output. The button reads
**Write notes** in this state and **Enhance notes** once someone has typed;
same endpoint, same sheet, and with nothing typed Replace and Append are the
same so the sheet shows one button.

**Storage.** `MeetingRecording.notes Json?` holds the last enhance result and
`enhancedAt DateTime?` when it was accepted. Fields on the existing row, no new
table. A second Enhance overwrites.

**UX.**
1. The recorder's Done panel gets **Enhance notes** as primary (Insert
   transcript stays secondary). While it runs: "Reading your notes and the
   transcript…", 10 to 20 s.
2. A side sheet shows the enhanced note rendered read-only, with added
   sections marked "Added" and citation chips live. Buttons: **Replace note**,
   **Append below**, Cancel.
3. Replace first saves a named collab version "Before enhance" (the existing
   versions system), then replaces the body. Append adds the enhanced sections
   under a `---` divider. Either way the transcript goes under the collapsed
   `### Transcript` toggle as today.
4. The Done panel then reads "Enhanced on Oct 10, 2:14 PM" and offers Re-run.

### 3. Cited transcript spans

A new BlockNote inline content type `transcriptCite` with props
`{ recordingId, at, end }`, rendered as a small chip showing `mm:ss`. Hover
shows the transcript line; click opens the transcript panel scrolled to it
(the existing `?transcript=` view, extended to accept `&at=`). Modeled on
`schema/mention.tsx`. Cites survive copy/paste within DALI and degrade to plain
`[12:34]` text on export.

This is a collab schema addition. Older clients ignore unknown inline content
rather than deleting it, but it still needs the usual flag in the PR and a
check against `persistence.ts`'s clone rule.

### 4. Action items into Tasks

Only for project meetings (tasks need a project).

- The enhanced note renders action items as checklist items. Each shows a
  **→ Task** hover action; the Enhance sheet also has **Create tasks** with
  the whole list pre-checked, owners pre-filled from roster matches, due dates
  blank.
- Created through the existing task service (`create-task` path used by the
  board and MCP): title = item text, assignee = owner, description = one line
  linking back to the note with the citation time, status Todo, no sprint.
- The checklist item gets a `taskMention` inline (extend the mention spec with
  a task kind) so the note shows the task's live status, and the Task's
  description links the note. `MeetingRecording.notes.actionItems[i].taskId`
  records the link so a re-run does not create duplicates.

### 5. Post-meeting nudge

New job `meeting-notes-nudge`, 5 min interval, idempotent through
`MeetingReminderLog` with a new `kind`. Rules, evaluated 15 min after the
occurrence's end:

- Recording Done and neither inserted nor enhanced → notify the recorder:
  "Your transcript for {meeting} is ready. Enhance the notes?" linking to
  `?transcript=<id>`. Registry event `meeting.transcript_ready`, in-app and
  desktop banner on by default, email off.
- No recording and the note body is still the untouched template → notify the
  organizer once: "No notes yet for {meeting}." Event `meeting.notes_empty`,
  in-app only by default. Honors the per-series `recordPrompt` opt-out as a
  proxy for "leave this meeting alone".

### 6. MCP

- `get_meeting` gains `transcriptAvailable: boolean` and `recordings: [{ id,
  status, recordedSeconds, enhancedAt }]`.
- New `get_meeting_transcript({ meetingId | recordingId, occurrenceStart?,
  from?, to? })` returning lines with resolved speaker names, bounded to 2,000
  lines per call with paging. Same audience as the note.
- New `enhance_meeting_notes({ recordingId, apply: "replace" | "append" |
  "preview" })` so an agent can do the whole flow; preview returns the JSON.

## Permissions

Enhance, Create tasks and Replace require edit access to the note (same as
Insert today). Citation chips and the transcript panel follow the note's read
audience. Task creation additionally requires the actor be allowed to create
tasks on that project; the sheet hides the option otherwise.

## Privacy

Enhance sends the note body and transcript to the configured AI provider,
which Write notes already does for the transcript. The confirmation copy on
the Enhance button says so the first time per user. Nothing else changes in
retention: `notes` on the row is deleted with the row by the janitor.

## Delivery

Three PRs, each shippable behind the existing `ai-meeting-notes` flag.

1. **Templates, nudge, MCP read tools.** No editor schema change. Smallest
   risk, immediately useful.
2. **Enhance with preview, Replace/Append, version snapshot, citation chips.**
   The schema addition is flagged in the PR per the collab caveat.
3. **Action items into Tasks, task mention, enhance MCP tool.**

Rough size: PR 1 two days, PR 2 three to four days, PR 3 two days.

## Open questions

1. Replace by default, or Append? Granola replaces. Replace plus the saved
   version is the proposal.
2. Template ownership: lab defaults per type with a project override, as
   above, or project only?
3. Should Create tasks be one click with no confirmation when owners are all
   matched? Proposal: the sheet always shows the list once, pre-checked.
4. Nudge to the recorder only, or to the organizer too when they differ?
5. Model: Sonnet 5 for Enhance by default, Opus 5 as an Admin ▸ AI toggle?
