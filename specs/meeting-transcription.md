# Meeting transcription v2: browser-first capture, self-hosted ASR, speaker labels

Status: reviewed draft, 2026-10-09 (rev 3: batch-first on one platform).
Replaces the on-device Apple recognizer path shipped in #1739 / #1743 / #1749 /
#1752 behind the `ai-meeting-notes` flag (still off).

## Why

The v1 recorder proved the product shape (Record button on the note, transcript,
Claude writes Summary / Decisions / Action items) but is boxed in by its
transcription engine:

- `SFSpeechRecognizer` is the weakest ASR option available, needs Dictation
  enabled, and fails silently when it isn't.
- It runs one task per app, which forced #1752 to mix mic and system audio into
  one stream and throw away the You / Others split.
- It only exists in the macOS desktop app. Web, Windows, iPad and phone users get
  nothing.
- The transcript is keyed to a collab room string, not to a meeting, and is
  deleted the moment it is inserted into the note.

v2 keeps the UX and the privacy posture (audio is never kept) and swaps the
engine for one we host, so every client can record and every transcript carries
speaker labels and a link back to the meeting occurrence.

## Decision summary

| Area | Decision |
|---|---|
| Shape | **Batch at stop.** Audio is captured during the meeting and processed once when it ends: speech-to-text and speaker diarization in one GPU pass. No live transcript in the MVP; the design keeps the seam for adding it later (see "Later: live transcript"). Decided 2026-10-09. |
| Processing host | One Modal app, `dali-asr`, T4 GPU, scale to zero. One image, one function. No Fly ASR app. |
| ASR model | NVIDIA Parakeet TDT 0.6B v3 (FP16 on GPU), 25 languages detected automatically (no language parameter exists), word timestamps. CC-BY-4.0 weights baked into the image. |
| Speaker diarization | pyannote `speaker-diarization-community-1`, run on every channel in the same pass. |
| Capture format | Raw 16 kHz mono s16 PCM from an `AudioWorklet` in the browser and from the desktop recorder. Every chunk independently decodable, works in every browser, no container parsing. Bandwidth (~115 MB per channel-hour) accepted. |
| Capture sources | Browser on any OS: mic always, call audio from a tab where `getDisplayMedia` audio exists (Chrome/Edge). Desktop app: mic + Core Audio system tap, shipped as PCM. Inside the desktop shell the native option is the default. |
| Speaker labels | Two layers: channel (You = mic, Others = call audio) for free, then diarization within a channel (Speaker 1, 2, 3). Any editor of the note can rename to roster names. |
| Audio handling | PCM chunks in private S3 under `recordings/<id>/`, read by Modal via 30-minute presigned URLs, deleted when processing completes. `recording-finalizer` job and a one-day lifecycle rule as backstops. |
| Transcript handling | Words and lines persisted on `MeetingRecording`, linked to `scheduledMeetingId` + `occurrenceStart`. Read access follows the note; edit actions follow note edit access. Retention via `retention-janitor`, 365 days. |
| Provider seam | `app/lib/transcription/` exposes `TranscriptionProvider.process(recording)` with one implementation (`modal`). Swapping vendors later is a contained change. |
| Record prompt | Organizer notification at start, in-page banner for any editor during the window, desktop one-tap banner only for live DALI meetings where a note exists or can be created. Per-series opt-out. |
| Privacy | Transcript audience = note audience. Audio deleted at finalize. Modal retains job metadata, logs and the result (words and timings), never audio. Per-project Disabled switch. Not a HIPAA environment by design. |
| CI | `deploy-asr.yml` runs `modal deploy` per branch on `asr/**` changes, plus a Python test job in `test.yml`. Part of the MVP. |
| Cost at 100% adoption | $20 to $35 a month during term, mostly inside Modal's $30 Starter credit. See "Costs". |

## Architecture

```
 browser / desktop app            dali-api (Fly, 2 machines)                 dali-asr (Modal, T4)
 ───────────────────              ──────────────────────────                 ────────────────────
 mic ─┐ AudioWorklet  POST chunk   auth, own-row, idempotent store
 tab ─┘ 16k PCM    ─────────────▶  PUT S3 recordings/<id>/<ch>/<seg>/<seq>.pcm
   ◀── { stopRequested }
                                  POST stop  ──▶ presign chunks ──────────▶  POST /process (bearer)
                                                                               spawn job: fetch PCM,
                                                                               Parakeet → words,
                                                                               pyannote → segments
                                  ◀── POST /api/meeting-recordings/:id/result (HMAC) ◀── { words, segments }
                                  assign speakers, build lines,
                                  DELETE S3 prefix, finalizedAt
   ◀── poll GET /:id  { status: Processing | Done, lines, speakers }
```

Nothing public is added except the Modal endpoint, which sits behind a bearer
secret and only accepts a job description; it is handed presigned URLs and calls
back with an HMAC-signed body.

### Clients

**Capture format (all clients).** 16 kHz mono signed 16-bit PCM, posted in 20 s
chunks (640 KB) as `audio/pcm;rate=16000;channels=1`. The browser produces it
with an `AudioWorklet` that downsamples from the device rate. Chosen over
`MediaRecorder` Opus because a second recorder (Continue) emits a new WebM
header mid-stream with reset timestamps, Safari cannot produce WebM at all, and
the server would have had to run ffmpeg over untrusted containers. PCM chunks
are independent, so retries, gaps and resumes are trivial and every browser
with `getUserMedia` works.

**Browser.**

- Mic: `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
- Call audio (optional): `getDisplayMedia({ video: true, audio: true,
  systemAudio: "include" })`, stop the video track immediately. Supported in
  Chrome and Edge (Windows and ChromeOS everywhere; macOS on Chrome 141+ with
  macOS 14.2+). Firefox and Safari return no audio track, so the option is
  hidden when a probe stream has none, with a one-line explanation.
- One worklet pipeline per channel. Chunks carry `channel` (`mic` | `call`),
  `seq` (per channel, from 0) and `segment` (increments on Continue). Timeline
  position is `segmentStarts[segment] + seq * 20`.
- Upload: one request in flight per channel. Blobs queue in memory, capped at
  20 chunks (12.8 MB); beyond that the pill shows "Upload stalled" and the
  queue drops the oldest chunk, leaving a gap. Retry with exponential backoff
  (1, 2, 4, 8, max 30 s). A same-`seq` re-upload after a lost 2xx is
  idempotent on the server.
- The chunk response carries `stopRequested` and a reserved `lines: []` /
  `behindSeconds: 0` so the client contract does not change when live
  transcription is added. The page polls `GET /:id` every 3 s only while
  `status` is `Processing`.
- Tab close mid-recording: the existing localStorage backup finds the recording
  again. If the server has since finalized it (finalizer job), the chunks route
  returns 409 and the page shows "Recording ended while this tab was in the
  background" with whatever transcript exists.
- iOS Safari suspends audio worklets in background tabs. Documented limitation;
  the native wrapper is the fix later.

**Desktop app (macOS).**

- `Recorder.swift` drops `SFSpeechRecognizer`, `Transcriber` and the `Mixer`.
  It keeps `MicCapture` and `SystemAudioCapture` and emits 16 kHz mono PCM
  buffers per source.
- `recording.rs` batches each source into 20 s chunks and posts them to the
  chunks route with `channel` = `mic` | `call`. The ownership probe before the
  mic opens becomes `POST /:id { action: "claim" }` (owner-only, returns the
  segment offset); `append` is gone.
- Old builds (0.1.7 to 0.1.11; note `tauri.conf.json` says 0.1.11 while
  `desktop/package.json` says 0.1.9, fix in this PR) call `append` and get
  `410 { error: "Update the DALI OS app to record." }`. They treat that as a
  silent no-op, so the page cannot rely on the message: when a recording stays
  `Pending` for 30 s after the deep link opened, the page itself shows "Update
  the DALI OS app to record, or record in this browser instead."
- Inside the desktop shell's WKWebView there is no `getDisplayMedia`, so the
  start sheet defaults to the native option when the shell is detected, and
  the browser mic path is the fallback. Verify in this PR that wry grants mic
  `getUserMedia` in the main window (the camera scanner from #1645 suggests
  the permission plumbing exists; audio needs confirming).

### dali-asr (Modal, T4)

Python 3.12. Image: PyTorch CUDA, `nemo_toolkit[asr]` or the ONNX runner for
Parakeet (whichever benchmarks faster on T4; FP16 PyTorch is the default
choice), `pyannote.audio`, weights for both baked in at build. One
`fastapi_endpoint` (`web_endpoint` is deprecated) `POST /process` behind
`Authorization: Bearer $DIARIZE_SECRET`. It spawns the job and returns in
milliseconds; the job runs detached and calls back.

Input:

```json
{ "recordingId": "…", "callbackUrl": "…",
  "channels": [
    { "channel": "mic",  "segments": [{ "startSeconds": 0, "chunks": [{ "seq": 0, "url": "…" }, …] }], "maxSpeakers": 1 },
    { "channel": "call", "segments": [ … ] }
  ] }
```

Per channel: fetch chunks in order, concatenate PCM per segment (gaps where a
`seq` is missing are filled with silence of the right length so timestamps stay
absolute), run Parakeet for words with timestamps offset by `startSeconds`, run
pyannote for `[{ s, e, speaker }]`. The mic channel in a call with `call`
audio present gets `maxSpeakers = 1`; in-person recordings pass the roster size
as `max_speakers` when known.

Output, via callback:

```json
{ "recordingId": "…",
  "channels": { "mic": { "words": [{ "s": 843.9, "e": 844.3, "w": "we" }, …],
                         "segments": [{ "s": 840.0, "e": 851.2, "speaker": 1 }, …] },
                "call": { … } },
  "error": null }
```

Callback: `POST {callbackUrl}` with headers `X-Dali-Timestamp` (unix seconds)
and `X-Dali-Signature: sha256=HMAC(DIARIZE_SECRET, "${timestamp}.${rawBody}")`.
dali-api rejects timestamps older than 5 minutes, compares in constant time and
requires `body.recordingId === params.id`. Repeat delivery is idempotent. A
callback arriving after the finalizer marked the row `Failed` is still applied
and sets `Done`.

Timing on a T4 for a one-hour, two-channel recording: cold start 30 to 60 s,
Parakeet about 1 minute per channel-hour, pyannote about 1.5 to 2 minutes per
channel-hour, so roughly 5 to 7 minutes end to end. The UI says "Transcribing,
usually a few minutes."

Presigned URLs: 30-minute expiry, generated at dispatch, never stored or
logged. Modal retains call inputs, results and stdout for its retention
period, so the function catches every exception and re-raises with the input
dict redacted; URLs are dead within 30 minutes and the result holds words and
timings only. The function has `timeout=900` and `retries=1`; a second failure
calls back with `error` set.

Logging: recording id, channel, audio seconds, stage latencies. Never text.

### dali-api

New module `app/lib/transcription/`:

- `provider.ts`: `interface TranscriptionProvider { process(req: ProcessRequest): Promise<void> }`
  and `getTranscriptionProvider()` reading `DIARIZE_URL`, `DIARIZE_SECRET`.
  Unset means unavailable (503, like the AI routes).
- `modal.ts`: the one implementation (presign chunks, POST the job).
- `words.ts` (pure, unit-tested): `assignSpeakers(words, segments)` by
  word-midpoint overlap, `wordsToLines(words, segments)` grouping on pauses
  > 0.8 s, sentence punctuation and speaker boundaries, `mergeChannels(lines)`
  interleaving by time. Lines are always rebuilt from words. Cross-channel
  echo de-duplication is deferred to PR 2 after real recordings show how often
  it is needed.
- `chunks.server.ts`: S3 put under `recordings/<id>/<channel>/<segment>/<seq
  padded>.pcm`, list, presign, delete prefix. Reuses `app/lib/s3.ts`.

Routes:

- `POST /api/meeting-recordings` (exists): also accepts `scheduledMeetingId`
  and `occurrenceStart` (resolved by the page from `page.meetingNoteId` /
  `meetingOccurrenceStart`, or sent by the desktop from its upcoming-meetings
  poll). When sent a meeting id without a document, the server calls
  `attachMeetingNote` for the occurrence (`scheduled-meeting.ts:754`), which is
  get-or-create and race-safe. Its two refusals surface as `noteRequired`
  (meeting has no type and no note) and `forbidden` (only organizer or Core may
  create the first note). Enforces a lab-wide cap: more than
  `MAX_ACTIVE_RECORDINGS` (default 12) rows in `Pending` or `Recording` returns
  503 with "Recording is busy right now, try again in a few minutes."
- `POST /api/meeting-recordings/:id/chunks` (new): raw body, `Content-Length`
  checked before reading (≤ 700 KB), content type `audio/pcm`, query
  `channel`, `segment`, `seq`. Owner-only. Stores the chunk (same key overwrite
  is idempotent), records `channels` and the per-channel high-water `seq`,
  bumps `lastChunkAt`. Response `{ stopRequested, behindSeconds: 0, lines: [] }`.
  409 if the recording is already finalized or processing.
- `POST /api/meeting-recordings/:id` actions (owner-only unless noted):
  `claim` (desktop probe; returns segment offset), `stop` (sets
  `stopRequested`; when the client confirms its last chunk landed, or after
  60 s, sets `status: Processing` and calls `provider.process`; a recording
  with zero chunks finalizes immediately), `resume` (new segment; only while
  `Stopped` and not yet processing), `speakers` (any editor via
  `canRecordInto`: `{ "mic:1": userId | text }`).
- `GET /api/meeting-recordings/:id` (exists, widened): owner gets everything;
  any user for whom `authorizeCollabDoc(user, rec.documentName).allowed` gets
  a read-only view (status, lines, speakers), so the meeting page's Transcript
  link works for the note's audience. Everyone else 404.
- `POST /api/meeting-recordings/:id/result` (new): HMAC callback, no session,
  as specified above. Stores words per channel, assigns speakers, builds
  lines, sets `status: Done` (or `Failed` with `error`), deletes the S3
  prefix, sets `finalizedAt`.
- `DELETE` (exists): owner or Core. Deletes S3 objects and the row.
- `POST /api/ai/meeting-notes` (exists): accepts `recordingId`, any editor via
  `canRecordInto`; formats lines as `[mm:ss] <Speaker name>: text` from the
  speaker map so the prompt sees real names.

Resume semantics: a stopped recording can be continued until processing
starts. Once `Processing`, Continue is disabled; a new recording on the same
note is the path.

### Data model

Additive migration on `MeetingRecording` (plus one column drop, flagged in the
PR description for `migration-check`):

```prisma
model MeetingRecording {
  id, documentName, userId, stopRequested, recordedSeconds, error, createdAt, updatedAt   // existing
  status             MeetingRecordingStatus @default(Pending)   // Pending Recording Stopped Processing Done Failed
  scheduledMeetingId String?
  scheduledMeeting   ScheduledMeeting? @relation(fields: [scheduledMeetingId], references: [id], onDelete: SetNull)
  occurrenceStart    DateTime?
  channels           String[]  @default([])         // "mic" | "call"
  // Segment start offsets in seconds, index = segment. Continue appends one.
  segmentStarts      Float[]   @default([])
  // Highest seq stored per channel per segment, for the job description.
  chunkIndex         Json      @default("{}")       // { mic: [41, 12], call: [41] }
  lastChunkAt        DateTime?
  // Per channel word arrays with absolute timestamps; lines derive from these.
  words              Json      @default("{}")       // { mic: [{ s, e, w, sp }], call: [...] }
  // [{ at, end, text, channel, speaker? }] speaker is "mic:1", "call:2", …
  lines              Json      @default("[]")
  speakers           Json      @default("{}")       // { "mic:1": "<userId>" | "Alex" }
  insertedAt         DateTime?
  finalizedAt        DateTime?                       // audio deleted
  @@index([scheduledMeetingId, occurrenceStart])
}
```

`MeetingRecordingStatus` gains `Processing` and `Done`. `systemAudio Boolean`
is dropped (superseded by `channels`; never set in prod, flag off).
`ScheduledMeeting` gains `recordings MeetingRecording[]` and `recordPrompt
Boolean @default(true)`. `Project` gains `recordingPolicy RecordingPolicy
@default(Allowed)` with `enum RecordingPolicy { Allowed Disabled }`.
`MeetingReminderLog` gains `kind ReminderKind @default(Reminder)` (`Reminder |
RecordPrompt`); its unique index is dropped and recreated as
`(scheduledMeetingId, occurrenceStart, userId, kind)` in the same migration.

Row size: words for a one-hour two-channel meeting are roughly 400 KB of JSON,
written once at the callback. If it ever matters, words move to an S3 object
that survives finalize.

The 24 h stale sweep in `createRecording` removes only rows with `finalizedAt
IS NULL` and deletes their S3 prefix too, so no orphaned audio. Finalized
transcripts fall under `retention-janitor` with a new `meetingTranscriptDays`
setting (default 365) next to its existing `retentionMonths`.

### Jobs

One new entry in `app/jobs/registry.ts`, in PR 1:

- `recording-finalizer`, every 5 min. (a) Any `Recording` row with
  `lastChunkAt` older than 10 minutes is treated as stopped: start processing
  if it has chunks, else finalize empty. (b) Any `Processing` row older than
  30 minutes with no callback is retried once (`provider.process` again), and
  marked `Failed` with audio deleted after a second 30 minutes; a late callback
  still applies. (c) Any `Pending` row never claimed after 30 minutes is
  deleted. Idempotent, `take: 50`.

Observability: dali-api logs stage timings from the callback (ids and
durations only); a warning log when any processing exceeds 20 minutes. Modal's
dashboard covers the GPU side. No new alerting system.

### Consent and visibility

New Hampshire is all-party consent. The product carries the signal:

- The start sheet says: "Everyone in the meeting should know it's being
  recorded. A recording badge shows on this note while it runs. Don't record
  meetings where patient, student record, or other protected information will
  be discussed."
- While a recording is live, every viewer of the note sees a red "Recording ·
  <name>" pill in the top bar. It rides on Hocuspocus awareness, which already
  fans out to every viewer of the room: the recorder sets `{ recording: {
  userId, since } }` in its awareness state and clears it on stop. No new
  polling (PR #2043 removed per-minute revalidation on purpose). The meeting
  page reads active recordings once in its loader.
- The flag description changes to: "Audio is processed by a GPU job DALI
  runs, then deleted within minutes of the recording ending. Only the
  transcript is kept, visible to whoever can see the note."

### UX

Record button stays in the top bar of any editable Drive doc. Clicking opens a
sheet:

1. **Start sheet.** Microphone picker (default device preselected, live level
   meter). Toggle "Include call audio from a browser tab" when supported.
   Inside the desktop shell the first option is "Capture everything on this
   Mac with the DALI OS app" and it is the default. The consent line. Primary
   button "Start recording". Hidden entirely when the project's
   `recordingPolicy` is `Disabled`.
2. **Recording.** The button becomes a pill with a timer and level meter so
   people can see it is hearing them. The side panel shows "Recording. The
   transcript appears a few minutes after you stop." plus the channel list
   (Microphone, Call audio) with live levels. States: "Upload stalled" when
   the queue is full. Pause, Stop.
3. **Processing.** After Stop: "Transcribing and labeling speakers, usually a
   few minutes." The page polls every 3 s. The user can leave; the note shows
   a small "Transcript on its way" marker and the panel picks up where it was
   on return. On failure: "Transcription failed. Try recording again." with
   Discard.
4. **Done.** Lines with You / Others and Speaker chips; each chip is a dropdown
   listing the occurrence roster plus "Someone else…" for free text; any
   editor can rename and every line updates.
5. **Actions.** "Write notes" (any editor; Claude, uses names) and "Insert
   transcript" (collapsed toggle, as today). Both leave the row in place with
   `insertedAt` set. "Discard" (owner or Core) deletes after confirm.
6. **Later.** The meeting page shows a Transcript link for an occurrence that
   has one, for anyone who can view the note. MCP `get_meeting` gains
   `transcriptAvailable` and `recordingIds`; a `get_meeting_transcript` tool
   follows in the notes PR.

Reuse: `Select` for mic and speaker pickers, `Toggle` for call audio, `Modal`
for the sheet, `useDialog().confirm` for discard, `Tooltip` on the pill.

### "Record this meeting?" prompt

Granola notifies one minute before any event with two or more attendees and
offers to start when a meeting app is open; Notion surfaces events 15 minutes
early with one-click start. The pattern: offer recording at the moment the
meeting begins, where the user already is, in one tap.

**Three surfaces, one prompt.**

1. **Notification at start.** New job `meeting-record-prompts`, interval 1
   minute, setting `leadMinutes` default 1. Dispatches a new registry event
   `meeting.record_prompt` (area Meetings, kind `MeetingRecordPrompt`,
   `timeSensitive: true`) via `notify()` to the occurrence's **organizer
   only**, so it lands in the bell, as a desktop banner and as a Slack DM per
   preference. Default preference: in-app and desktop on, email and Slack off.
   The link opens the occurrence's note with `?record=1`, which opens the
   start sheet. Idempotency via `MeetingReminderLog.kind = RecordPrompt`.
2. **In-page banner.** Opening the note or the meeting page while the
   occurrence is live (5 minutes before start until end) shows a slim banner
   above the editor: "This meeting is starting. Record it?" with Record and
   Not now. Shown to any editor when no recording exists for the occurrence.
   Ships in PR 1; needs no job.
3. **Desktop one-tap, only for live DALI meetings.** The desktop app polls
   the user's upcoming occurrences (same shape as `list_my_upcoming_meetings`).
   Within an occurrence's window it shows a native banner "<title> is live.
   Record it?" when either Zoom or Teams is frontmost
   (`NSWorkspace.frontmostApplication` bundle id, no permission needed) or two
   minutes have passed since start. Google Meet runs in a browser tab and
   detecting it needs Screen Recording permission, so Meet-linked and
   in-person meetings use the two-minute fallback. The banner is shown only
   when the occurrence already has a note tab, or the meeting has a type and
   the user is organizer or Core (the conditions under which
   `attachMeetingNote` succeeds). Record starts capture immediately with
   system audio and mic, no page open; the server resolves the note. Not now
   dismisses for the occurrence. Nothing ever fires for a call that is not a
   DALI scheduled meeting.

**Opting out.** Not now is per viewer per occurrence (localStorage). "Don't
suggest recording this meeting" in the banner's overflow sets
`ScheduledMeeting.recordPrompt = false` for the series (organizer or Core) and
silences all three surfaces for everyone. Meetings with `attendanceMode =
SelfCheckIn` and more than 30 participants default to `recordPrompt = false`.

The existing 15-minute `meeting.reminder` is unchanged; `Notification` carries
one link and the reminder's already lands on the meeting page, which has the
note link.

### Privacy posture

The bar is "meeting notes and transcripts must not leak", not HIPAA. Protected
health information should never be in a DALI meeting; partners de-identify
before anything reaches the lab, and the consent sheet says so.

**Access.** A transcript has exactly the audience of the note: reads gate on
`authorizeCollabDoc` for the note's room, edits (speakers, write notes) on
`canRecordInto`, discard on owner or Core. No listing route returns
transcripts across meetings.

**Audio.** Exists from first chunk to finalize, typically minutes past stop.
Private S3 with server-side encryption, written by dali-api, read by Modal via
30-minute presigned URLs that are never logged. Deleted at finalize; finalizer
job and one-day lifecycle rule as backstops.

**Vendors.** Fly and Neon already hold every meeting note. The feature adds
Modal, which sees audio for the minutes a job runs and retains job metadata,
logs and the result (words and speaker timings, which is the transcript) for
its retention period. Audio is never retained there. The enhance step uses the
same Anthropic path as the doc assistant.

**Logging.** No transcript text, audio bytes or token values in logs, Node or
Python. Ids and durations only.

**Project opt-out.** `Project.recordingPolicy` Allowed | Disabled on project
settings, Core only. Disabled hides the Record button and all three prompts
for the project's meetings.

### Security

- Chunks route: owner-only, `Content-Length` ≤ 700 KB checked before the body
  is read, content type `audio/pcm` only, `seq` ≤ 720 per segment (4 hours),
  segments ≤ 20. PCM needs no parsing, so there is no decoder attack surface.
- Lab-wide active-recording cap (503) and the existing per-user AI limits on
  "Write notes".
- S3 keys private; dali-api writes; Modal reads via 30-minute presigned URLs.
- Modal endpoint behind a bearer secret; callback HMAC covers timestamp and
  body, constant-time compare, 5-minute window, recording id must match the
  route.
- CSP unchanged: `getUserMedia`, `getDisplayMedia` and worklets are not CSP
  governed and uploads go to `'self'`.

### Costs (100% of meetings recorded, in term)

| Item | Basis | 215 h/mo | 320 h/mo |
|---|---|---|---|
| Modal T4, STT + diarization, two channels | ~6 to 9 GPU minutes per meeting hour at $0.59/hr plus CPU/mem | $14 to $20 | $20 to $32 |
| S3 temp audio | ~115 MB per channel-hour, hours of life | <$1 | <$1 |
| **Total** | | **$15 to $21** | **$21 to $33** |

Modal's Starter plan includes $30 of monthly credit, so the typical month is
free or close to it. For comparison at the same volume: Amazon Transcribe batch
$77 to $115, Deepgram or AssemblyAI with diarization $37 to $150. The Claude
enhance call is separate and already tracked under Admin → AI Usage.

### Rollout

**PR 1 (this worktree): capture + batch processing + linkage + speaker UI.**
- `asr/`: Dockerfile with both models baked in, `modal_app.py` (`/process`
  endpoint, job, callback), pytest on a 30 s two-speaker PCM fixture checking
  word count, timestamps and segment count, plus a benchmark script with T4
  timings recorded in the PR.
- `app/lib/transcription/`: provider, `modal.ts`, `words.ts`,
  `chunks.server.ts`; unit tests for `assignSpeakers`, `wordsToLines`,
  `mergeChannels`, chunk index bookkeeping, same-seq idempotency, HMAC verify
  (including replay with a fresh timestamp).
- Migration + schema (status values, `recordingPolicy`, `recordPrompt`,
  `MeetingReminderLog.kind`, `systemAudio` drop).
- Chunks route; `claim` / `stop` / `resume` / `speakers` actions; widened
  `GET`; result callback route; 410 for old desktop `append`;
  active-recording cap; `recording-finalizer` job; `retention-janitor`
  setting.
- `MeetingRecorder.tsx`: start sheet, `AudioWorklet` PCM capture per channel,
  upload queue with retry, pill with timer and levels, processing state,
  speaker chips and rename, 409 and "update the desktop app" states.
- Recording pill over Hocuspocus awareness; flag copy; consent line.
- In-page "Record this meeting?" banner on note and meeting pages; `?record=1`.
- `Project.recordingPolicy` toggle on project settings.
- Meeting page Transcript link; `get_meeting` fields.
- Desktop: strip the recognizer, ship PCM, `claim` probe, native-default
  start sheet inside the shell, fix the version skew, bump to 0.1.12. Flag in
  the PR description that `/api/meeting-recordings/:id` changes affect the
  native app.
- CI: `.github/workflows/deploy-asr.yml` (`modal deploy` into the branch's
  environment on `asr/**` changes) and a `test-asr` job in `test.yml`.
- Ops checklist in the PR (see "Modal setup").

**PR 2: prompts + tuning.**
- `meeting-record-prompts` job and `meeting.record_prompt` event.
- Desktop: upcoming-meetings poll, "<title> is live" banner with one-tap
  record, Zoom / Teams frontmost detection, `noteRequired` / `forbidden`
  handling (opens the note page instead).
- Cross-channel echo de-duplication, tuned on real recordings.

**PR 3 (separate design, not this spec): notes model.**
- Typed notes as anchors for the enhance step, per-type templates seeded into
  new notebook tabs, cited transcript spans, action items into Tasks, post-
  meeting nudge job, MCP transcript tools.

### Later: live transcript

Everything in PR 1 is a prefix of the live design, so adding it later is
additive:

- One more Modal function, CPU, kept warm for the meeting (`scaledown_window`
  of 60 s; chunks arrive every 20 s), running Parakeet INT8 ONNX on the newest
  contiguous chunks plus one chunk of context. Called from the chunks route
  under a per-recording `pg_advisory_xact_lock`, writing words and a
  per-channel cursor into `words` / a new `cursors` column.
- The chunks response's reserved `lines` and `behindSeconds` fields fill in;
  the panel renders lines live; the stop-time GPU pass then only runs
  diarization and re-splits the existing words.
- Cost at full adoption rises by roughly $0.20 per meeting hour (about $45 to
  $65 a month).

### Later (other)

- Voice enrollment so "You" resolves to the recorder's name across meetings
  (biometric data; needs its own consent copy).
- "Always record this meeting" series setting honored by the desktop app.
- Google Meet window detection on desktop (Screen Recording permission).
- iOS / native mobile capture.
- Uploading a recording made outside DALI OS.
- Moving `words` to S3 if row size ever matters.

### Decisions log (2026-10-09)

1. Language: nothing to configure; Parakeet v3 detects it.
2. Voice enrollment: later.
3. Diarize both channels; mic capped to one speaker when call audio exists.
4. Transcript retention: 365 days via `retention-janitor`.
5. Record prompt audience: organizer only for the notification; any editor for
   the in-page banner.
6. "Don't suggest recording" is per series.
7. Self-host (Modal) confirmed over hosted STT after corrected cost comparison.
8. Raw PCM capture for every client; bandwidth accepted.
9. Transcript edits (speakers, write notes) open to any editor of the note;
   reads to anyone who can view it; discard to owner or Core.
10. Batch-first on one platform: no Fly ASR app, no live transcript in the
    MVP. Live transcript is an additive follow-up on the same seam.

### Why processing runs on Modal, not inside dali-api

- **GPU.** Diarization needs one (30 to 60 minutes per meeting hour on CPU).
  Fly removed GPU machines in August 2026. With the GPU already required, STT
  rides along in the same pass for about a minute per channel-hour.
- **Runtime.** Parakeet and pyannote are Python; one image serves both.
- **Shape.** Processing is zero most of the day and spikes on check-in
  afternoons; a scale-to-zero function fits and costs nothing idle.
- **Isolation.** A model crash or OOM never touches the collab server, and a
  gigabyte of weights never rides along a `dali-api` deploy.

Alternatives considered: a Fly CPU app for live STT plus Modal for diarization
(rev 2; two platforms for one pipeline, dropped), everything on an always-on
AWS GPU (about $380 a month), SageMaker async (minutes of cold start and an S3
queue for no gain over Modal), hosted STT (comparable cost, weaker speaker
labels, audio to a vendor; the provider seam keeps it available).

### Modal setup (one-time, by an admin)

1. Workspace on the Starter plan with a card; environments `staging` and
   `prod`.
2. CI token stored as `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` GitHub secrets.
3. Hugging Face: accept the gated terms on
   `pyannote/speaker-diarization-community-1` and the models it depends on;
   create a read token; store as Modal Secret `huggingface` (`HF_TOKEN`) in
   both environments. Weights are baked at image build, so the token is never
   needed at runtime.
4. Modal Secret `dali-asr` per environment with `DIARIZE_SECRET`; same value
   on the matching `dali-api` Fly app.
5. After the first `modal deploy`, copy the endpoint URL into the matching
   `dali-api` Fly app as `DIARIZE_URL`.
6. S3: lifecycle rule expiring `recordings/` after one day on the existing
   bucket.
