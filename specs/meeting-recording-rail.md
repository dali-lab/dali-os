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
| inserted | "Already in this note. Discarding only removes the recording, not what was inserted." | transcript | | Discard (owner or Core) |
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

- In-document preview tinting with Keep / Undo.
- Inline "Make task" hover affordance on checklist items.
- Any change to the record prompt banner or the native pill.

## Risks

- The comments rail column scrolls with the paper for margin alignment; the
  Recording rail is sticky in the same column. Verify the comments rail is
  untouched when Recording is closed, and that forcing `railVisible` false
  while Recording is open does not lose open comment threads.
- `MeetingRecorder.tsx` is ~1,900 lines; the split above is the bulk of the
  work. Behaviour is unchanged by the hook extraction, so the existing route
  and component tests must keep passing before the rail is wired.
