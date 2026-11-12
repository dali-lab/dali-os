# Enhance: processing progress, in-note review, undo, and motion

Status: built in PR #2237 (behind the `ai-meeting-notes` flag).
Design: Paper file "DALI OS — Design System", page "Meeting Notes · Enhance" (B0, B1, B3, C-series keyframes). Motion prototype: the private "Enhance Motion Prototype" artifact.
Builds on: `specs/meeting-transcription.md` (the Modal job), `specs/meeting-recording-rail.md` Step 2 (inline marks, Keep/Revert).

## 1. Goals

1. Show real progress while a recording is transcribed and its speakers are labeled, instead of one static "Usually a few minutes" line.
2. Move Enhance review into the note (B1) and split action items into a second pass (B3).
3. Keep and Revert are ordinary edits that Cmd+Z and Cmd+Shift+Z undo and redo, with no extra UI for it.
4. Every visual transition is driven by what changed in the document, so undo, redo and a teammate's edit animate the same way a click does.

Out of scope: live transcript during recording, a single 0 to 100% bar (stages have no honest common weight), any change to how Enhance itself writes.

## 2. Processing progress

### 2.1 What exists today (verified Oct 18)

- `asr/modal_app.py` `run_job` processes each channel and POSTs exactly one HMAC-signed callback at the end to `/api/meeting-recordings/:id/result`.
- Modal's `FunctionCall` API reports only done or not done. There is no progress to poll.
- `MeetingRecordingStatus` has one value, `Processing`, for the whole run.
- The client polls `GET /api/meeting-recordings/:id` every 3 s (`POLL_MS`) while `phase === "processing"`.

### 2.2 Where real progress comes from

| Stage | Source | Unit |
|---|---|---|
| `starting` | No signal. Modal is booting the T4 and loading models. | none, indeterminate |
| `fetching` | `process_channel` fetching chunks per segment | chunks done / total |
| `transcribing` | `transcribe_windowed` splits PCM into 300 s windows (`split_pcm_windows`) | windows done / total, shown as minutes |
| `labeling` | pyannote `hook=` on `SpeakerDiarization.apply`. Confirmed in pyannote.audio 4.0.7 source: `segmentation` and `embeddings` call `hook(step, artifact, completed=, total=)` per batch | batches done / total for those two steps; `speaker_counting` and `discrete_diarization` are single calls |

Channels (mic, call) run one after the other, so the payload carries the channel index.

Pin `pyannote.audio==4.0.7` in the Modal image (`modal_app.py` currently installs it unpinned). The hook signature is the contract.

### 2.3 Wire format

Same route, same HMAC headers, a new body shape distinguished by `progress`:

```json
{ "recordingId": "…", "progress": { "stage": "transcribing", "channel": 1, "channels": 2, "completed": 7, "total": 12, "audioSeconds": 3480 } }
```

- Sent at most once every 3 s, plus once at each stage boundary.
- Sent from a background thread with a 3 s timeout. A failed or slow progress POST is logged and dropped; it never fails or delays the job.
- The final result callback is unchanged.

### 2.4 Server

- Migration: `MeetingRecording.progress Json?` (nullable, additive; safe for migration-check).
- `api.meeting-recordings.$id.result.ts`: when the body has `progress`, validate the shape and run `updateMany({ where: { id, status: "Processing" }, data: { progress } })`. The status guard means a late progress POST (retry, second Fly machine) can never overwrite `Done` or `Failed`.
- `applyResult` clears `progress` on Done and Failed.
- Owner and follower GET responses add `progress`.
- Modal `retries=1` can restart a job; progress then goes back to `starting`. Show that as it is. Do not fake monotonic progress.

### 2.5 Client

- `use-meeting-recording.ts` stores `progress` from the existing poll. No new requests.
- Before the first progress row arrives, the stage is `starting`.
- Speaker colors appear only at Done, from the real diarized segments in `lines`. During `labeling` we know how far along it is, not who spoke.

### 2.6 Tests

- `asr/tests`: progress emitter throttles, survives a raising POST, and reports windows done/total from `transcribe_windowed` with a mocked model; hook adapter maps pyannote steps.
- `api.meeting-recordings.$id.result.test.ts`: progress body accepted with a valid signature, rejected without; `updateMany` is scoped to `status: "Processing"`; a progress POST after Done changes nothing.
- `use-meeting-recording.test.tsx`: poll stores progress; Done clears it.

## 3. In-note review (B1) and tasks pass (B3)

Summarized here; the Paper page is the source of truth for layout.

- The Recording rail is not shown during review. One bar under the notebook tabs holds the lifecycle: processing, enhancing, "N suggestions" with Keep all and Revert all, then the tasks step, then a confirmation that collapses.
- Keep and Revert sit on the focused or hovered marked block. A changed block shows "You wrote: …" under it instead of a separate struck-through block.
- Citation chips show the speaker ("Maya · 14:02"); hover shows the quote; "Open in transcript" opens the rail.
- Step 2 starts when no marks remain and the note has action items from this Enhance. Owner and due chips render on those checklist lines. They are an overlay keyed to `notes.plan.actionItems`, not block content, so this needs no BlockNote schema change and no CRDT migration.

## 4. Undo and redo

### 4.1 What works today (verified Oct 18)

- Collab notes use y-prosemirror's `yUndoPlugin` (a `Y.UndoManager` tracking the local `ySyncPluginKey` origin). Cmd+Z and Cmd+Shift+Z are bound by the editor.
- Enhance's write is one `editor.transact` (`enhance-render.ts`), so one undo step.
- `keepAllEnhance` and `revertAllEnhance` are each one `editor.transact`, so one undo step each.
- Single `keepEnhanceBlock` / `revertEnhanceBlock` are plain `updateBlock` / `removeBlocks` edits, so they are undoable.
- Pending review is derived from the marks in the document, so an undo that brings a mark back brings the review UI back with no extra state.
- BlockNote classifies y-undo transactions as `source.type === "undo-redo"` (`getBlocksChangedByTransaction.ts`, BlockNote 0.52.1). `localEditKeepIds` only treats `local`, `paste` and `drop` as edits, so undo and redo never trigger "editing a line keeps it".
- Expected, not yet verified: restoring a removed block through Y undo brings back its attributes, including the block id, so `priorBlocks[id]` and action-item matching keep working after an undo. The Playwright case in 4.4 must assert the id survives Revert then Cmd+Z on an added block.

### 4.2 The one fix

**Undoing Enhance looks like finishing the review.** Cmd+Z right after Enhance removes every mark, and the mark-scan effect then POSTs `reviewed` and sets `reviewedAt` (`hadMarks && effective.length === 0`), which would also start step 2. Fix: skip the `reviewed` POST when the change that cleared the last mark has `source.type === "undo-redo"`, and show the pre-Enhance state ("Transcript ready" with Enhance notes) instead of step 2. Cmd+Shift+Z re-applies the write, and the marks bring review back.

No "⌘Z to undo" hint. Revert is already on the line, and Cmd+Z is the editor's normal undo (Granola doesn't advertise it either).

Tasks already created are never undone: Cmd+Z only changes the note.

### 4.3 Deferred until someone notices

- `Y.UndoManager` merges edits within its default 500 ms `captureTimeout`, so two quick Keeps, or typing then Keep, undo as one step. Fix if needed: `undoManager.stopCapturing()` around each decision (`findCollabUndoManager` in `DocEditorImpl.tsx` already finds the manager).
- Clicking a Keep/Revert pill or a bar button moves focus out of the note, so the next Cmd+Z goes nowhere until you click back in. Fix if needed: `onMouseDown={e => e.preventDefault()}` on the pills, `editor.focus()` after bar actions.

### 4.4 Tests

- An `undo-redo` change that clears the last mark does not POST `reviewed` and does not start step 2.
- `localEditKeepIds` ignores `undo-redo` (already covered for `local`/`paste`/`drop`; add the negative case).
- Playwright: Revert an added line, press ControlOrMeta+Z, the line returns with its tint and the same block id.

## 5. Motion

Durations and easing are in the prototype's timing spec and the Paper C-series. Rules for the build:

- **Drive animation from mark diffs, not from clicks.** One effect compares the previous and current mark scan: a mark that appears blooms, a mark that clears drains, a removed block collapses, a restored text crossfades. Undo, redo, Keep all, a remote collaborator's Keep, and a click then all animate identically.
- Animations run on overlay elements (tint, edge) and on the block's height, never by changing block content, so they cannot write into the Y.Doc.
- Easing `cubic-bezier(.2,.8,.2,1)`. Nothing over 360 ms except the processing loops.
- `prefers-reduced-motion`: every transition becomes a crossfade of 120 ms or less; loops stop.
- The topbar recorder button shows a small ring for the current stage's fraction.

## 6. Order of work

1. The undo fix (4.2) on the current rail UI. Small, and valid whatever the visual design.
2. Progress reporting (section 2): asr, migration, route, hook, poll.
3. B1 bar and in-block Keep/Revert, replacing the rail during review.
4. B3 tasks overlay.
5. Motion layer (section 5) across 3 and 4.

## 7. Open questions

- Does a created task replace the checkbox with a task chip, or sit beside it?
- Where does Enhance again live after step 2: the bar's ⋯ menu while the bar exists, then the topbar recorder menu?
- Narrow screens: does the bar stick under the topbar while scrolling the note?
