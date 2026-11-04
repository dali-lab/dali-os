# Recording at the app level

Status: approved Oct 28 2026 (Kiran). Paper: "DALI OS — Tab Redesign" → page "Recording · App level" (R1 desktop, R2 pill states, R3 browser). Pill style = R2 "Quieter B".

## Problem

All live recording state lives in `useMeetingRecording`, mounted per note by `RecordingMount`. Leaving the note:

- **Browser capture**: the `useBlocker` dialog says "Recording stops if you leave this tab". If the user leaves anyway the hook never tears down (no unmount cleanup), so the mic stays open and chunks keep uploading with no UI; returning to the note reads the `browser` backup and stops the session ("Recording stopped when this page reloaded").
- **Desktop capture**: the dialog says "Come back to this note to stop it". With desktop tabs every tab switch is a navigation, so the dialog fires on each switch.
- Nothing outside the note shows that a recording is running or lets you stop it.

One live recording per user at a time is a device fact (desktop `recording.rs` refuses a second; one mic) and stays.

## Design

### 1. Live session module (`app/components/meeting-recorder/live-session.ts`)

A client-only singleton store (plain module + `subscribe`/`getSnapshot`, read with `useSyncExternalStore`). It owns the **current user's** live recording, whichever mode:

```ts
type LiveSession = {
  recordingId: string
  documentName: string
  href: string            // note URL, from the server
  title: string           // note title, from the server
  captureMode: 'browser' | 'desktop'
  status: 'starting' | 'recording' | 'stopping' | 'stopped'
  startedAt: number       // ms, for the timer
  channelsActive: Channel[]
  levels: Record<Channel, number>
  stalled: Record<Channel, boolean>
  conflicted: boolean
}
```

It owns **browser capture** outright: the `WorkletCapture`s, `MediaStream`s, `ChunkUploadQueue`s, the segment counter, `uploadChunk`, `armChannel`, `handleConflict`, `teardownCapture`, and the browser half of `stop()` (flush, drain `STOP_DRAIN_MS`, teardown, POST `{action:"finish", seconds}`). These move out of the hook verbatim in behavior. Because they live outside React, navigating anywhere in the SPA (including desktop tab switches and `TabKeepAlive` hiding the page) no longer affects capture.

Exports (names indicative):
- `useLiveSession()` → `LiveSession | null`
- `startBrowserSession({ recordingId, documentName, micStream, callStream?, segment })`
- `adoptDesktopSession({ recordingId, documentName, status, startedAt })` (desktop: the module only tracks, the app captures)
- `stopLiveSession()` → browser: drain + finish; desktop: POST `{action:"stop"}` and wait for the poll to see Stopped
- `clearLiveSession(recordingId)` (after Write notes / Insert / Discard / Done)
- `refreshLiveSession()` → `GET /api/meeting-recordings/active` (below)

The store refreshes once on app load, after start/stop, and polls every 10s **only while a session exists** (no polling for users with no recording). A remote stop (`stopRequested` on a chunk response) and a 409 conflict update the store, not a hook.

Guard: starting a browser recording while a session for another note exists fails with "Stop the recording in <title> first." (link to it).

### 2. Server: `GET /api/meeting-recordings/active`

New loader in `api.meeting-recordings.ts` (or `api.meeting-recordings.active.ts`): the requesting user's newest row with `userId = me` and status in `Pending | Recording | Stopped` and `insertedAt` null, plus `title` (`documentTitle`) and `href` (`doc:<pageId>` → `/documents/<pageId>`; other entities → null href, pill shows "Recording" with no link). Returns `{ recording: null }` when none. Owner-only; no transcript text. Gated by `ai-meeting-notes` (same as the recorder). Tests for: none, own live row, someone else's row ignored, inserted row ignored, non-doc documentName.

### 3. Hook changes (`use-meeting-recording.ts`)

- `startBrowser` / `resume` (browser) open the streams then hand them to `startBrowserSession`; the hook reads `channelsActive`/`levels`/`stalled`/`status` from `useLiveSession()` when the session's `documentName` matches.
- `stop()` calls `stopLiveSession()`; when the session goes `stopped` the hook moves to `review` (or `processing` if `conflicted`).
- **Pick-up on mount**: if the live session is this note's browser session, adopt it (phase `recording`/`stopping`/`review`), do NOT run the "page reloaded → stop" branch. That branch now only runs when there is a `browser` backup but no live session in memory (a real reload).
- Desktop start/resume also call `adoptDesktopSession` so the pill knows immediately.
- Remove `useBlocker` and its "Leave while recording?" dialog entirely.
- `beforeunload` moves to the module: registered while a **browser** capture is live (a real unload still kills audio). Add a `pagehide` handler that sends `fetch(..., {keepalive:true})` POST `{action:"finish", seconds}` so a closed tab lands as Stopped immediately instead of waiting for the 10 min finalizer.
- Followers (`remote`) are untouched: the module is only ever the current user's own recording.

### 4. Recording pill (`app/components/meeting-recorder/RecordingPill.tsx`)

Rendered when `useLiveSession()` is non-null, the flag `ai-meeting-notes` is on, and the current pathname is not the session's `href` (the note's rail already shows controls there).

Placement: **left of the page bar actions**, never after them (Kiran: don't move the usual icons). v2 shell: first child of the right cluster in `shell/PageBar.tsx`, before the `actionsRef` slot. Legacy shell: the same spot in LayoutOS's `topBar` right cluster.

Look (Paper R2 "Quieter B"), h-[30px] rounded-full, `border border-os-container`, no fill:
- **Recording**: 8px `bg-os-danger` dot (pulse, respects reduced motion), timer `font-bold tabular-nums text-os-danger` (mm:ss, h:mm:ss past an hour), title `text-os-grey` truncate max ~140px and links to `href`, then Stop: `bg-os-card border border-os-container shadow-sm`, 9px rounded-[2px] `bg-os-danger` square + "Stop" `text-foreground`; hover → `bg-os-danger border-os-danger`, square and label white.
- **Starting**: same, timer replaced by "Starting".
- **Stopping**: no border emphasis, spinner + "Stopping" + title, `text-os-grey`, not clickable.
- **Stopped**: mic icon `text-os-accent`, title, button "Finish in note →" (`bg-os-accent text-white`) linking to `href`. Stays until the session clears.
- Narrow: title hidden below `md`; Stop label hidden below `sm` (square only, `aria-label="Stop recording"`).
- Dark: same tokens (os-* tokens already flip).

Use the existing `Tooltip` primitive for the icon-only Stop. No confirm on Stop (it's reversible via Continue).

### 5. Tab and browser indicators

- **Desktop tabs** (`DesktopTabs.tsx` `SortableTab`): when `sameUrl`-by-pathname matches the session `href` and status is starting/recording/stopping, render a 16px `bg-os-danger/18` circle with an 8px `bg-os-danger` dot instead of the icon/emoji.
- **Browser favicon**: while a session is starting/recording/stopping, swap `<link rel="icon">` to a red-dot variant (`/icon-blue-recording.svg`: the existing icon with a red dot badge bottom-right) on every DALI tab; restore after. No title prefix (dropped in review: redundant with the favicon and Chrome's own dot).

### 6. Out of scope

- macOS tray "Stop recording" item (needs a desktop release).
- Changing the one-recording-per-user limit.
- Followers' (`remote`) UI.

## Tests (replace behavior comments with these)

- `live-session.test.ts`: start → recording; stop drains then POSTs finish with seconds; `stopRequested` response stops; 409 conflict marks `conflicted` and tears down; mic track `ended` stops; call track `ended` keeps mic; guard against a second session; poll only while a session exists; pagehide sends keepalive finish.
- Hook: navigating away and back adopts the live browser session (no stop, no dialog); reload (no in-memory session, browser backup) still stops with the existing message; the old "Leave while recording?" tests are replaced by "no prompt on in-app navigation".
- `RecordingPill.test.tsx`: each state's text/role; hidden on the note's own href; Stop calls `stopLiveSession`.
- Route test for `/api/meeting-recordings/active`.
- `DesktopTabs`: recording tab renders the dot.

## PR notes

- Release note: "You can now leave a meeting note while recording. A recording bar at the top of every page shows the timer and lets you stop it."
- Touches no desktop shell routes.
