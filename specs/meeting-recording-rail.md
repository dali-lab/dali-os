# Recording rail: replacing the meeting recorder's stacked modals

Draft 3, Oct 10 2026. Approved in design review round 2 with the corrections below folded in. Scope: UI only. Backend,
verification, the block merge, createTasks and the taskMention chip stay as
shipped. Ships on PR #2081.

## Problem

After Start, every state of the recorder lives in a modal over the document:
live, review, processing, the Done "Transcript" modal, and the Enhance sheet
as a second modal over that, plus confirm and choice dialogs on top. The live
modal blocks the editor the feature asks people to type in. The document
already shows the enhanced notes, the transcript toggle, the checklist items
and the task chips, so the modals duplicate the note in smaller boxes.

## Shape

One surface after Start: a **Recording rail** docked beside the document.
Recording and stopping never render in a blocking surface at any width.

- **Wide canvas** (the existing >= 1150 px check in `DocumentEditor.tsx`): a
  sticky, full-viewport-height panel in the right-hand column, its own
  scroll, 400 px wide (the action rows need it; the comments rail stays 320).
- **Narrow canvas**: the live state is the top-bar button alone (red dot,
  timer); clicking it opens a small `Popover` with the meters, the status
  line and Stop. The drawer is used only for review, processing, failed,
  ready, generating, preview and enhanced, where a blocking surface is
  acceptable because nothing is being typed. The drawer is `ui/Drawer.tsx`,
  extracted from `TasksDrawer` in `AttentionPanel.tsx` (`{ open, onClose,
  title, children, footer?, width?: 360 | 480 }`), a `Modal` variant so
  Escape and focus handling come for free. Phone: full width.
- The **start sheet stays a modal** (`RecordStartSheet.tsx`): it is a real
  decision (source, mic, consent). The one-line tip moves out of it into the
  rail's live state. The per-user consent confirm before Enhance becomes one
  sentence on this sheet: "Enhance sends your typed notes and the transcript
  to the AI provider."
- The **top-bar button stays** and mirrors the state: "Record" (idle), red dot
  and timer (recording), "Transcribing…", "Transcript", "Enhanced". After
  Start it toggles the rail, with `aria-pressed`.
- The desktop shell's native prompt and the record-prompt notification are
  unchanged; their `?record=1` deep link opens the start sheet as today, and
  the rail opens on Start like any other path.
- Someone else's recording ("Recording · Name") shows in the rail too, read
  only, with the transcript when it lands.

## Wiring

- `MeetingRecorder` is mounted in the route's `topBarActions` slot, outside
  the canvas flex row. `DocumentEditor` gains a `rail?: { node: ReactNode;
  open: boolean }` prop. The route owns `recordingRailOpen` state and passes
  the rail node from the recorder; the recorder exposes `open`/`setOpen`
  through its hook (below).
- Today the rail column renders only when `railVisible = commentsOpen &&
  containerWide && hasComments`. New rule: the column renders when
  `containerWide && (railVisible || rail.open)`. While `rail.open`, the
  comments rail is not shown: `railVisible` passed into `DocEditorImpl` is
  forced false so comment threads fall back to the floating controller rather
  than portal into a hidden column. A two-tab header (Comments | Recording)
  appears only when `hasComments`; otherwise the Recording rail has a plain
  header with its title and Close.
- Below 1150 px `DocumentEditor` renders `rail.node` inside `ui/Drawer`
  itself, since it is the only component that knows `containerWide`; `rail`
  therefore carries `onClose` as well as `open`. Live states (recording,
  stopping) are never rendered in the Drawer; the route passes `rail.open`
  false for them on narrow canvases and the top-bar Popover carries the live
  controls. The Drawer for `processing` opens only from a click, never on its
  own, because people type notes while transcription runs.
- Sticky rail (wide): `position: sticky` with a top offset that clears the
  document top bar, and height `100vh` minus that bar, so the rail's own
  scroll does not clip its footer.

## Rail layout, top to bottom

1. **Header**: title "Recording", a visible Close button, the status line and
   the primary button. One primary, at most two secondaries, never a dialog.
2. **Body by state** (below).
3. **Transcript**: full height below the header once lines exist. Speaker
   chips pinned at the top; each chip is a `Select` over the roster plus
   "Someone else…", which reveals an inline text field under the chip with
   Save (replaces the `dialog.choice` + `dialog.prompt` pair). A
   `SearchInput` filters lines. Lines keep `[mm:ss] Label: text`.

### States

| State | Status line | Body | Primary | Secondary |
|---|---|---|---|---|
| starting (desktop) | "Opening the DALI OS app…"; after 30 s "The DALI OS app didn't respond." | after 30 s: "Update the DALI OS app, or record in this browser." | after 30 s: Record in this browser | Cancel, Get the app |
| recording | red dot, `12:04` | browser: "Microphone · Call audio" with level meters; desktop: "Recording via the DALI OS app." Both: "Type rough notes in the note; Enhance fills them in after you stop." | Stop | |
| stopping | "Stopping…"; after 60 s "The DALI OS app hasn't confirmed the stop." | after 60 s: "The app may have quit before it finished uploading." | after 60 s: Transcribe anyway | after 60 s: Discard |
| review | "12:04 recorded. Transcribing starts when you finish." | reload recovery adds "Recording stopped when this page reloaded. Continue to pick it up." | Transcribe | Continue, Discard |
| processing | "Transcribing and labeling speakers. Usually a few minutes." | | | Discard |
| failed | the error | | Try again (hidden once the audio is gone) | Discard |
| ready | "Transcript ready. 3 speakers." | transcript | AI on: Write notes / Enhance notes. AI off: Insert transcript | AI on: Insert transcript, Discard |
| generating | "Reading your notes and the transcript…" | transcript | | Cancel |
| preview | "Preview: 4 blocks changed, 6 added." plus "2 blocks changed while this ran and were left as typed." when > 0 | the preview list and action rows | Apply | Cancel |
| enhanced | "Enhanced Oct 10, 2:14 PM by Ada. Enhance again rebuilds the notes from the current text and the transcript." | action rows with Create tasks for items without tasks (when the note is on a project and the viewer can create tasks); transcript | Enhance again | Discard (owner or Core) |
| inserted | "Transcript inserted. Enhance can still write notes from it. Discarding only removes the recording, not what was inserted." | transcript | AI on: Enhance notes | Discard (owner or Core) |
| stale preview | "Someone enhanced this note after your preview." | | Reload preview | Cancel |

Following someone else's recording uses the same states read-only with the
owner's name in the status line and no primary.

### When the rail opens on its own

- On Start from the sheet (modal to rail handoff; the sheet closes, the rail
  opens, focus moves to the rail header).
- On reload recovery into `review`, since it needs a decision.
- Never on `processing` finishing: the top-bar button changes to "Transcript"
  and a toast says "Transcript ready." The owner's auto-preview still runs in
  the background so the preview is instant when they open the rail.

### Enhance preview and action items, in this step

The preview stays a list for now (in-document tinting is the next step) but
renders in the rail body: each changed or added block with its heading above
it for context, then the action items as the existing editable rows, stacked
on two lines to fit 400 px (line 1: checkbox and text; line 2: owner `Select`,
due `DateField`, source phrase), then Create tasks. Apply and Cancel sit in
the header. After Apply, rows that have tasks read "Task created" with the
chip link; the rest keep Create tasks.

### Citation chips

The hover layer today delegates only `mouseover`/`mouseout`. Add a `click`
listener on the same container for `a[href*="?transcript="]`: plain clicks
prevent default, open the rail and scroll the transcript to `at`, highlighting
the line; modifier clicks and middle clicks fall through to the browser.
Keyboard: Enter on a focused chip link does the same. The
`?transcript=<id>&at=` URL keeps working for deep links from outside the page
(notifications, task descriptions), opening the rail the same way.

### Accessibility

- Rail: `role="complementary"`, `aria-label="Recording"`, visible Close.
- Opening from a chip moves focus to the highlighted transcript line's
  container; Escape or Close returns focus to the chip. Opening from the
  top-bar button returns focus there.
- The rail is not a dialog; focus is not trapped. The Drawer (narrow, non-live
  states only) traps focus as a Modal does.
- Status line changes are announced with `aria-live="polite"`.

### Cut

The Done "Transcript" modal, the Enhance sheet modal, the auto-open on done,
the consent `dialog.confirm`, the speaker `dialog.choice`/`dialog.prompt`,
the 409 confirm (replaced by the stale preview state).

Kept: the start sheet, Discard's confirm (destructive), the leave-page
confirm while recording, the "Insert transcript" label as shipped.

## Component split

- `useMeetingRecording()` in `meeting-recorder/use-meeting-recording.ts`: the
  state machine, fetches, polling, capture, backup, and `open`/`setOpen`.
  Everything that is in `MeetingRecorder.tsx` today except rendering.
- `MeetingRecorder.tsx`: the top-bar button and the start sheet mount; thin.
- `RecordStartSheet.tsx`: the start sheet as it is today.
- `RecordingRail.tsx`: presentational; takes the hook's state and callbacks
  and renders the header and body per state. Tests render each state from a
  fixture.
- `RecordingTranscript.tsx`: chips, search, lines, scroll-to and highlight.
- `EnhancePreview.tsx`: the preview list and action rows.
- `ui/Drawer.tsx`: extracted from `TasksDrawer`, which then uses it.

## Not in this step

- Inline "Make task" hover affordance on checklist items.
- Any change to the record prompt banner or the native pill.
- In-document preview tinting with Keep / Undo: specified below as step 2.

## Risks

- The comments rail column scrolls with the paper for margin alignment; the
  Recording rail is sticky in the same column. Verify the comments rail is
  untouched when Recording is closed, and that forcing `railVisible` false
  while Recording is open does not lose open comment threads.
- `MeetingRecorder.tsx` is ~1,900 lines; the split above is the bulk of the
  work. Behaviour is unchanged by the hook extraction, so the existing route
  and component tests must keep passing before the rail is wired.

## Step 2: inline enhance preview

Draft 2, Oct 12 2026, after a design review of draft 1. Scope: UI plus one
small change to the recording's stored notes. The merge rule, server
verification, createTasks and citation chips stay as shipped.

### Problem

The step-1 preview is a list in the rail: "Changed" and "Added" rows, each
showing only the new text. Nobody can tell where a row lands in the note or
what a changed block said before. Removals (template headings the model left
empty) are not listed at all, so they vanish on Apply with no warning. People
cannot evaluate Apply, so they either apply blind or never use Enhance.

Granola's enhance is inline: when the meeting ends it rewrites the note in
place, keeps the original notes behind a toggle, and offers no per-change
review. Granola is single-user. A DALI note is shared, so the inline shape
has to work when two people are looking at the same preview.

### Shape

Enhance writes to the document immediately, marked, and the review happens
in the note. There is no separate Apply step.

- **Preview is a write.** Clicking Enhance notes runs the plan through the
  existing merge and replays the ops against the editor as it does today,
  in **one editor transaction** (so the editor's own Cmd+Z reverts the whole
  write, never half of it), with every block the plan touches marked. The
  "Before enhance" version snapshot and the `enhanced` lock happen first,
  exactly as Apply does now.
- **Marks live in the document**, so every editor sees the same preview,
  on any device, after a reload, and in the Drawer on a narrow canvas.
  The marker is the block's existing `backgroundColor` prop, a default
  BlockNote prop on every block, stored in Yjs as a free string, with two
  values the Colors sub-menu never offers: `enhance-added` and
  `enhance-prior`. No editor schema change, so nothing for other clients to
  decode. The Colors sub-menu in `DocSideMenu` keeps its normal palette;
  choosing any color from it on a marked block counts as Keep. Theme CSS
  maps `enhance-added` to a soft accent tint and `enhance-prior` to a grey
  tint with `text-decoration: line-through` on the block, in light and dark.
  The strikethrough is CSS on the tint, never an inline style written into
  the content.
- **Changed block.** Keeps its id, gets the new text and the `enhance-added`
  tint. Its prior text is not written to the document. At write time the
  recording's stored notes gain `priorBlocks`, a map from block id to the
  full prior block (content, props, children), so Revert restores the
  original inline styles, links, comment marks and task chips rather than
  plain text. The rail row for a changed block shows "Was: <prior first
  line>", and the side-menu Revert button's tooltip shows the same.
- **Added block.** `enhance-added` tint. Citation chips are the ordinary
  links they are today and work during review.
- **Removed block** (an untouched-template heading the model never filled):
  stays in place with the `enhance-prior` tint. Deleted on Keep, cleared on
  Revert.
- **Keep** clears the tint on a block, or deletes a removed block. **Revert**
  restores a changed block from `priorBlocks`, deletes an added block, or
  clears the tint on a removed block. Both are ordinary editor operations on
  specific block ids, never a whole-document replace, so a teammate's typing
  in untouched blocks during the review is never lost. The "Before enhance"
  version stays in History as the safety net and is not used by Revert.
- **Per-block and whole-note.** The rail header shows Keep all and Revert
  all while any marked block exists. Each rail row carries its own Keep and
  Revert, at every width, since the row is where the before text is and the
  side menu is a hover gutter that touch and compact density never show.
  On a wide canvas each marked block also gets Keep and Revert in its side
  menu (`DocSideMenu`). A local edit to a marked block counts as Keep: the
  tint clears. Local means the editor transaction's origin is this client,
  not a remote Yjs update and not the editor's own undo stack.
- **Concurrent review.** Two people acting on the same block is last writer
  wins over Yjs. The worst case is one person's Keep landing after the
  other's Revert, which leaves the block in whichever state arrived last,
  never a lost block. Keep all and Revert all iterate the marks present at
  click time and skip ids that are already gone.
- **Anyone who can edit the note can keep or revert**, not only whoever ran
  Enhance. The marks are shared state; gating review to the enhancer would
  leave a tinted note nobody else could clean up. A viewer without edit sees
  the pending state with no Keep or Revert and no instruction.
- **Pending is derived from the document**, not from a flag: the rail is in
  the `pending review` state while any block carries a reserved tint. The
  scan runs on document change, memoized per Yjs transaction. No column to
  reconcile, nothing left behind if a tab closes, and marks that survive a
  Cmd+Z of the enhance write are cleared by the same scan. The stored notes
  gain `reviewedAt`, set when the last mark clears by any means, so the
  nudge job and MCP can tell "enhanced" from "enhanced and reviewed"; it is
  informational.

### Rail states, revised

| State | Status line | Body | Primary | Secondary |
|---|---|---|---|---|
| generating | "Reading your notes and the transcript…" | transcript | | Cancel |
| pending review | "Ada enhanced this note: 4 changed, 6 added, 1 removed." plus "2 blocks changed while this ran and were left as typed." when > 0 | change list (below), then the action rows and Create tasks | Keep all | Revert all |
| enhanced | "Enhanced Oct 10, 2:14 PM by Ada. Reviewed." | action rows, transcript | Enhance again | Discard (owner or Core) |
| stale preview | unchanged | | | |

The `preview` state and its Apply / Cancel pair are cut. While pending
review, Enhance again reads "Revert all and enhance again" and does exactly
that, so an unreviewed note is never stuck. Discard during pending review
reverts all first, then deletes the recording, so tints never outlive the
rail.

**Change list.** One row per marked block, in document order: the kind word
(Added, Changed, Removed), the first line of the new text, the heading above
it, "Was: <prior first line>" for a changed block, and Keep / Revert.
Clicking the row's text scrolls the note to that block and flashes it. Rows
disappear as blocks are kept or reverted and the status line counts tick
down.

**Narrow canvas.** The Drawer shows the same header and list, with Keep and
Revert on each row. The top-bar button reads "Review" with the pending count
while any mark remains.

**Someone else's enhance.** A viewer who arrives while marks exist sees the
`pending review` state with the enhancer's name. The owner-only background
auto-preview from step 1 (`use-meeting-recording.ts`, the effect after
`highlightAt`) is cut: there is nothing to pre-compute when preview and apply
are the same write, and a background write to a shared note is not
acceptable. Enhance runs only on a click.

### Marks and the rest of the note

- `backgroundColor` values other than the two reserved ones are untouched
  and never produced by Enhance.
- Paste: BlockNote reads `data-background-color` from clipboard HTML, so a
  marked block copied into another document would arrive marked with no
  recording behind it. The paste handler strips the two reserved values.
- Create tasks works during pending review; a task created from a marked
  checklist item links to that block id, and Keep leaves the id intact.
  Revert on a block that already has a task removes or restores the block
  and leaves the task, with the rail row reading "Task kept".
- Insert transcript, speaker renames and the Transcript toggle are
  unaffected: Enhance never marks the toggle.
- Server write paths refuse while marks exist: the generate endpoint and
  the MCP `enhance_meeting_notes` apply path both snapshot the live
  document, so they return "Keep or revert the current changes first" when
  any top-level block carries a reserved tint. The MCP apply path otherwise
  still writes directly with no marks: an agent run is a deliberate
  instruction with no reviewer at the screen.
- Retention janitor and version history ignore marks.

### Accessibility

- Marked blocks carry `aria-description` "Added by Enhance, pending review"
  / "Changed by Enhance, pending review" / "Removed by Enhance, pending
  review". Support is patchy, so the reliable channel is the buttons: rail
  rows and side-menu items are named "Keep change: <first line>" and "Revert
  change: <first line>", and each rail row starts with its kind word so the
  distinction is never color-only.
- Keep all and Revert all announce on the rail's live region: "Kept 11
  changes." / "Reverted 11 changes."

### Cut

The `preview` rail state, Apply, Cancel, the owner-only background
auto-preview, the "Changed" / "Added" rows that show text out of context.

### Risks

- Updating a changed block's content drops comment marks and task chips on
  that line. Pre-existing in Apply; `priorBlocks` makes Revert restore them,
  Keep does not bring them back. Note it in the row ("Was:" shows the old
  line) and accept.
- The reserved values are plain strings. A test on `DocSideMenu`'s Colors
  config asserts the palette never includes them, and the paste handler test
  asserts they are stripped.
- Deriving pending from a per-transaction scan is O(top-level blocks); the
  notes are short. Measure once on the longest prod note before shipping.
