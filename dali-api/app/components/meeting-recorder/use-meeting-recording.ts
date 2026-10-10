// The meeting recorder's state machine: fetches, polling, capture, backup,
// and open/setOpen — everything MeetingRecorder.tsx did before rendering was
// split out of it (specs/meeting-recording-rail.md "Component split"). No
// rendering lives here; RecordingRail / RecordStartSheet / RecordingTranscript
// / EnhancePreview take this hook's return value as props.

import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { desktopVersion } from "~/lib/desktop";
import { acquireCollabDoc, releaseCollabDoc } from "~/components/doc/collab-doc";
// Vite explicit-URL import: the worklet runs in AudioWorkletGlobalScope and is
// loaded via audioWorklet.addModule(url), so it has to resolve to a real URL
// rather than being bundled as a normal module (see worklet-processor.js for
// why it can't import anything, including this app's own bundler output).
import workletUrl from "./worklet-processor.js?url";
import {
  captureCallAudio,
  describeMicError,
  listMicDevices,
  openMic,
  startLevelMeter,
  WorkletCapture,
} from "./capture";
import { ChunkConflictError, ChunkUploadQueue } from "./upload-queue";
import { countSpeakersByChannel, formatClock, meetingNotesMarkdown, transcriptParagraphs } from "./transcript";
import { applyEnhancePlan, type EditorOp, type EnhanceActionItem, type SnapshotBlock, type StoredEnhanceNotes } from "./enhance-plan";
import { isUntouchedTemplate } from "~/lib/meeting-note-template";
import type {
  ActiveRecording,
  Channel,
  ChunkResponse,
  PollRecordingResponse,
  RecordingStatus,
  RosterUser,
  Speakers,
  StartRecordingResponse,
  TranscriptLine,
} from "./types";

/** "Oct 10, 2:14 PM" in the viewer's own locale/timezone — the "Enhanced …"
 *  banner doesn't need the year since it's always recent. */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Number(m[2]) - 1;
  return `${months[monthIndex] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

export type Phase =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  // Stopped, not yet committed to transcribing — the resume window the
  // server's `stop` (non-final) / `resume` actions exist for. Not named in
  // the client contract's summary phase chain, but "stopping" there covers
  // both "draining uploads" and "deciding what's next"; this is the second
  // half of that, kept as its own phase so the UI for it is simple.
  | "review"
  | "processing"
  | "done"
  | "failed";

export type CaptureMode = "browser" | "desktop" | null;

const POLL_MS = 3000;
const APP_WAIT_MS = 30_000;
const STOP_DRAIN_MS = 60_000;
// Desktop stop: how long to wait for the app's finish before offering a way out.
const STOP_WAIT_MS = 60_000;

type Backup = { id: string; link: string; aiEnabled: boolean; captureMode?: CaptureMode };
const backupKey = (documentName: string) => `dali:meeting-recording:${documentName}`;

function readBackup(documentName: string): Backup | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(backupKey(documentName)) ?? "null");
    return typeof saved?.id === "string" && typeof saved?.link === "string" ? saved : null;
  } catch {
    return null;
  }
}

function writeBackup(documentName: string, backup: Backup | null) {
  try {
    if (backup) window.localStorage.setItem(backupKey(documentName), JSON.stringify(backup));
    else window.localStorage.removeItem(backupKey(documentName));
  } catch {
    // Storage is unavailable (private window); the recording just isn't recoverable.
  }
}

function describeStartError(json: unknown): string {
  const code = (json as { error?: string } | null)?.error;
  if (code === "recordingDisabled") return "Meeting recording is turned off for this project.";
  if (code === "Not available") return "Meeting recording isn't available.";
  if (code === "Forbidden" || code === "forbidden") return "You don't have permission to record this document.";
  if (code === "noteRequired") return "This meeting has no note to record into.";
  if (code === "alreadyRecording") {
    const j = json as { ownerName?: string; ownerIsYou?: boolean };
    return j.ownerIsYou ? "You're already recording this note on another device." : `${j.ownerName ?? "Someone"} is already recording this note.`;
  }
  return code ?? "Couldn't start recording.";
}

const emptyLevels: Record<Channel, number> = { mic: 0, call: 0 };
const emptyStalled: Record<Channel, boolean> = { mic: false, call: false };

export type UseMeetingRecordingProps = {
  /** The collab room the notes land in. */
  documentName: string;
  scheduledMeetingId?: string;
  occurrenceStart?: string;
  /** The occurrence's attendees, for the speaker-rename chips. */
  roster?: RosterUser[];
  canEdit: boolean;
  /** Core can discard anyone's recording (the DELETE route already allows it). */
  isCore?: boolean;
  /** The note's live recording when this viewer didn't start it here: shown
   *  in place of Record so a second one is never started. */
  activeElsewhere?: ActiveRecording | null;
  /** Appends the notes Markdown, then the transcript lines under a collapsed
   *  toggle heading. False when the editor isn't ready. */
  onInsert: (markdown: string, transcript: string[]) => boolean;
  /** Opens the start sheet immediately (arriving via `?record=1`). */
  autoOpen?: boolean;
  /** Lets the recorder join the note's own collab awareness to flag "Recording
   *  · <name>" for every other viewer (RecordingPresencePill reads the same
   *  room). Omit to skip that — e.g. a read-only transcript view that never
   *  starts a recording of its own. */
  collabToken?: string | null;
  /** The page's seeded-template fields (specs/meeting-notes-model.md §1) —
   *  drives the Write notes / Enhance notes label and whether empty template
   *  headings get hidden on apply. */
  seededFromPageId?: string | null;
  seededTemplateHash?: string | null;
  /** A snapshot of the live editor's top-level blocks plus whole-body plain
   *  text, read fresh whenever Enhance needs it. Null while the editor isn't
   *  ready yet. */
  getNoteState?: () => { blocks: SnapshotBlock[]; bodyText: string } | null;
  /** Replays Enhance's merge ops against the live editor and inserts the
   *  transcript toggle if it isn't already there. False when the editor
   *  isn't ready. */
  onApplyEnhance?: (ops: EditorOp[], recordingId: string, transcript: string[], actionItems: EnhanceActionItem[]) => boolean;
  /** The meeting note's project, when it's on one (specs/meeting-notes-model.md
   *  §4) — tasks need a project, so Create tasks is hidden without one. */
  projectId?: string | null;
  /** Whether the viewer has task-create rights on `projectId`. Create tasks
   *  is hidden without it, same as the board's own gate. */
  canCreateTasks?: boolean;
  /** Fired once per task created from the sheet, so the note can append a
   *  link to the task on the matching checklist item. */
  onTaskCreated?: (itemText: string, taskId: string, projectId: string) => void;
};

export function useMeetingRecording({
  documentName,
  scheduledMeetingId,
  occurrenceStart,
  roster = [],
  canEdit,
  isCore = false,
  activeElsewhere = null,
  onInsert,
  autoOpen,
  collabToken,
  seededFromPageId = null,
  seededTemplateHash = null,
  getNoteState,
  onApplyEnhance,
  projectId = null,
  canCreateTasks = false,
  onTaskCreated,
}: UseMeetingRecordingProps) {
  const dialog = useDialog();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const desktopVer = desktopVersion();

  const [phase, setPhase] = useState<Phase>("idle");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  // `?transcript=<id>` opens an existing recording's Done view read-only for
  // anyone who can view the note (the GET route widens for them), even a
  // viewer this component otherwise wouldn't render anything for.
  const transcriptParam = searchParams.get("transcript");
  // `&at=<seconds>` (citation chips, specs/meeting-notes-model.md §3) scrolls
  // to and highlights the transcript line closest to that moment.
  const atParam = searchParams.get("at");
  const atSeconds = atParam !== null && atParam !== "" && Number.isFinite(Number(atParam)) ? Number(atParam) : null;
  const highlightLineRef = useRef<HTMLParagraphElement | null>(null);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [appUnreachable, setAppUnreachable] = useState(false);

  const [channelsActive, setChannelsActive] = useState<Channel[]>([]);
  const [levels, setLevels] = useState<Record<Channel, number>>(emptyLevels);
  const [stalled, setStalled] = useState<Record<Channel, boolean>>(emptyStalled);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);

  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [speakers, setSpeakers] = useState<Speakers>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Someone else's recording (or this user's from another device) that this
  // page is following rather than driving.
  const [remote, setRemote] = useState<{ ownerName: string; ownerIsYou: boolean } | null>(null);
  const [insertedAt, setInsertedAt] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [stoppingSince, setStoppingSince] = useState(0);

  // Enhance (specs/meeting-notes-model.md §2).
  const [enhanceNotes, setEnhanceNotes] = useState<StoredEnhanceNotes | null>(null);
  const [enhancedAt, setEnhancedAt] = useState<string | null>(null);
  const [enhancedByName, setEnhancedByName] = useState<string | null>(null);
  const [enhanceSheetOpen, setEnhanceSheetOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const autoEnhanceTried = useRef(false);
  // "Someone enhanced this note after your preview." — the 409 case
  // (specs/meeting-recording-rail.md's "stale preview" state, replacing the
  // old reload confirm dialog).
  const [stalePreview, setStalePreview] = useState(false);
  // Citation-chip click target (specs/meeting-recording-rail.md "Citation
  // chips"): scrolls/highlights a transcript line without relying on the
  // `?at=` URL param, which only matters on first mount.
  const [scrollTarget, setScrollTarget] = useState<number | null>(null);

  // Start-sheet config.
  const [useDesktopApp, setUseDesktopApp] = useState(desktopVer != null);
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(undefined);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [micPreviewError, setMicPreviewError] = useState<string | null>(null);
  const [callAudioWanted, setCallAudioWanted] = useState(false);
  const [callAudioUnsupported, setCallAudioUnsupported] = useState(false);

  const segmentRef = useRef(0);
  const captures = useRef<Partial<Record<Channel, WorkletCapture>>>({});
  const streams = useRef<Partial<Record<Channel, MediaStream>>>({});
  const queues = useRef<Partial<Record<Channel, ChunkUploadQueue>>>({});
  const conflictedRef = useRef(false);
  const claimed = useRef(false);

  const live = phase === "starting" || phase === "recording" || phase === "stopping";

  function teardownCapture() {
    for (const ch of Object.keys(captures.current) as Channel[]) {
      captures.current[ch]?.stop();
      queues.current[ch]?.destroy();
      streams.current[ch]?.getTracks().forEach((t) => t.stop());
    }
    captures.current = {};
    queues.current = {};
    streams.current = {};
    setChannelsActive([]);
    setLevels(emptyLevels);
    setStalled(emptyStalled);
  }

  // Clears everything locally without deleting the server row — the path
  // after a successful Write notes/Insert transcript, which leaves the row
  // in place with insertedAt set (spec: "Both leave the row in place").
  function clearLocalState() {
    teardownCapture();
    writeBackup(documentName, null);
    setRecordingId(null);
    setLink(null);
    setCaptureMode(null);
    setAppUnreachable(false);
    setRecordedSeconds(0);
    setLines([]);
    setSpeakers({});
    setError(null);
    setBusy(false);
    setRemote(null);
    setInsertedAt(null);
    setFinalized(false);
    setEnhanceNotes(null);
    setEnhancedAt(null);
    setEnhancedByName(null);
    setEnhanceSheetOpen(false);
    setEnhanceError(null);
    setStalePreview(false);
    autoEnhanceTried.current = false;
    segmentRef.current = 0;
    conflictedRef.current = false;
    setPhase("idle");
    setOpen(false);
    if (transcriptParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("transcript");
      setSearchParams(next, { replace: true });
    }
  }

  // Discard, or abandoning a recording before it ever captured anything —
  // both delete the server row, unlike clearLocalState's keep-the-row path.
  function reset() {
    if (recordingId) {
      void fetch(`/api/meeting-recordings/${recordingId}`, { method: "DELETE", credentials: "include" }).catch(
        () => null,
      );
    }
    clearLocalState();
  }

  // The row was deleted under us (the owner discarded it, or the finalizer
  // swept it): nothing to poll, nothing to keep.
  function recordingGone() {
    clearLocalState();
    toast.info(remote && !remote.ownerIsYou ? `${remote.ownerName} discarded the recording.` : "This recording was deleted.");
  }

  // ─── Pick a left-behind recording back up ──────────────────────────────
  useEffect(() => {
    if (claimed.current) return;
    const own = readBackup(documentName);
    const saved: Backup | null =
      own ??
      (transcriptParam ? { id: transcriptParam, link: "", aiEnabled: false } : null) ??
      (activeElsewhere ? { id: activeElsewhere.id, link: "", aiEnabled: false } : null);
    if (!saved) return;
    const following = !own && !transcriptParam && activeElsewhere ? activeElsewhere : null;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/meeting-recordings/${saved.id}`, { credentials: "include" }).catch(() => null);
      if (cancelled || claimed.current) return;
      if (!res) return;
      if (!res.ok) {
        if (res.status === 404) writeBackup(documentName, null);
        return;
      }
      const data = (await res.json()) as PollRecordingResponse;
      if (cancelled || claimed.current) return;
      claimed.current = true;
      setRecordingId(saved.id);
      setLink(saved.link || null);
      setAiEnabled(saved.aiEnabled);
      setChannelsActive(data.channels as Channel[]);
      setRecordedSeconds(data.recordedSeconds);
      setLines(data.lines);
      setSpeakers(data.speakers);
      setInsertedAt(data.insertedAt ?? null);
      setFinalized(Boolean(data.finalizedAt));
      setEnhanceNotes(data.notes ?? null);
      setEnhancedAt(data.enhancedAt ?? null);
      setEnhancedByName(data.enhancedBy ?? null);
      segmentRef.current = Math.max(0, (data.segmentStarts?.length ?? 1) - 1);
      if (data.error) setError(data.error);
      if (following) {
        setRemote({ ownerName: following.ownerName, ownerIsYou: following.ownerIsYou });
        setStartedAt(new Date(following.since).getTime());
      }
      if ((data.status === "Pending" || data.status === "Recording") && own?.captureMode === "browser") {
        // The tab that was capturing reloaded, so its mic is gone. Stop the
        // session rather than show a clock over nothing; Continue picks it up.
        setCaptureMode("browser");
        void fetch(`/api/meeting-recordings/${saved.id}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        }).catch(() => null);
        setError("Recording stopped when this page reloaded. Continue to pick it up.");
        setPhase("review");
        setOpen(true);
      } else if (data.status === "Pending" || data.status === "Recording") {
        setCaptureMode("desktop"); // no local capture to drive: follow the row by polling
        if (!following) setStartedAt(Date.now() - data.recordedSeconds * 1000);
        setPhase(data.status === "Pending" ? "starting" : "recording");
        if (!following) setOpen(true);
      } else if (data.status === "Stopped") {
        setCaptureMode((m) => m ?? "desktop");
        setPhase("review");
        if (!following) setOpen(true);
      } else if (data.status === "Processing") {
        setPhase("processing");
        if (!following) setOpen(true);
      } else if (data.status === "Done") {
        setPhase("done");
        if (transcriptParam) setOpen(true);
      } else {
        setPhase("failed");
        if (transcriptParam) setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // transcriptParam/searchParams only matter on first mount (a backup already
    // claimed shouldn't be re-evaluated when the URL changes later).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName]);

  // ─── Leaving mid-recording ──────────────────────────────────────────────
  useEffect(() => {
    if (!live) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [live]);
  const blocker = useBlocker(live);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void dialog
      .confirm({
        title: "Leave while recording?",
        description:
          captureMode === "desktop"
            ? "The recording keeps running in the DALI OS app. Come back to this note to stop it."
            : "Recording stops if you leave this tab.",
        confirmLabel: "Leave",
        cancelLabel: "Stay",
      })
      .then((leave) => (leave ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // ─── Recording presence: tell every other viewer via collab awareness ──
  useEffect(() => {
    if (!collabToken) return;
    if (phase !== "recording" && phase !== "stopping") return;
    const entry = acquireCollabDoc(documentName, collabToken);
    const awareness = entry.provider.awareness;
    const localUser = awareness?.getLocalState()?.user as { userId?: string } | undefined;
    awareness?.setLocalStateField("recording", { userId: localUser?.userId ?? "", since: Date.now() });
    return () => {
      awareness?.setLocalStateField("recording", null);
      releaseCollabDoc(documentName);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "recording" || phase === "stopping", documentName, collabToken]);

  // ─── Elapsed-time tick while live (both capture modes) ─────────────────
  useEffect(() => {
    if (phase !== "recording" && phase !== "stopping") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase, captureMode]);

  // ─── Desktop deep-link liveness poll (no local capture to time by) ─────
  useEffect(() => {
    if (captureMode !== "desktop" || !recordingId) return;
    if (phase !== "starting" && phase !== "recording" && phase !== "stopping") return;
    let cancelled = false;
    const createdAt = Date.now();
    async function tick() {
      const res = await fetch(`/api/meeting-recordings/${recordingId}`, { credentials: "include" }).catch(
        () => null,
      );
      if (cancelled || !res) return;
      if (res.status === 404) {
        recordingGone();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as PollRecordingResponse;
      if (cancelled) return;
      setChannelsActive(data.channels as Channel[]);
      setRecordedSeconds(data.recordedSeconds);
      setInsertedAt(data.insertedAt ?? null);
      if (data.finalizedAt !== undefined) setFinalized(Boolean(data.finalizedAt));
      if (data.notes !== undefined) setEnhanceNotes(data.notes ?? null);
      if (data.enhancedAt !== undefined) setEnhancedAt(data.enhancedAt ?? null);
      if (data.enhancedBy !== undefined) setEnhancedByName(data.enhancedBy ?? null);
      if (data.status === "Recording") {
        setAppUnreachable(false);
        setPhase((p) => {
          // The app has claimed the recording: the clock starts here, not
          // when the deep link was opened.
          if (p === "starting") setStartedAt(Date.now());
          return p === "starting" ? "recording" : p;
        });
      } else if (data.status === "Stopped") {
        setPhase("review");
      } else if (data.status === "Processing") {
        setPhase("processing");
      } else if (data.status === "Done") {
        setLines(data.lines);
        setSpeakers(data.speakers);
        setPhase("done");
      } else if (data.status === "Failed") {
        if (data.error) setError(data.error);
        setPhase("failed");
      } else if (Date.now() - createdAt > APP_WAIT_MS) {
        setAppUnreachable(true);
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [recordingId, captureMode, phase]);

  // ─── Processing poll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "processing" || !recordingId) return;
    let cancelled = false;
    async function tick() {
      const res = await fetch(`/api/meeting-recordings/${recordingId}`, { credentials: "include" }).catch(
        () => null,
      );
      if (cancelled || !res) return;
      if (res.status === 404) {
        recordingGone();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as PollRecordingResponse;
      if (cancelled) return;
      setInsertedAt(data.insertedAt ?? null);
      if (data.finalizedAt !== undefined) setFinalized(Boolean(data.finalizedAt));
      if (data.notes !== undefined) setEnhanceNotes(data.notes ?? null);
      if (data.enhancedAt !== undefined) setEnhancedAt(data.enhancedAt ?? null);
      if (data.enhancedBy !== undefined) setEnhancedByName(data.enhancedBy ?? null);
      if (data.status === "Done") {
        setLines(data.lines);
        setSpeakers(data.speakers);
        setPhase("done");
      } else if (data.status === "Failed") {
        if (data.error) setError(data.error);
        setPhase("failed");
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, recordingId]);

  // ─── Mic preview while the start sheet is open and unstarted ────────────
  useEffect(() => {
    if (!open || phase !== "idle" || useDesktopApp) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopMeter: (() => void) | null = null;
    setMicPreviewError(null);
    void (async () => {
      try {
        stream = await openMic(micDeviceId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stopMeter = startLevelMeter(stream, setMicLevel);
        const devices = await listMicDevices();
        if (cancelled) return;
        setMicDevices(devices);
        if (!micDeviceId && devices[0]) setMicDeviceId(devices[0].deviceId);
      } catch (err) {
        if (!cancelled) setMicPreviewError(describeMicError(err));
      }
    })();
    return () => {
      cancelled = true;
      stopMeter?.();
      stream?.getTracks().forEach((t) => t.stop());
      setMicLevel(0);
    };
  }, [open, phase, useDesktopApp, micDeviceId]);

  // Processing finishing never auto-opens the rail (specs/meeting-recording-
  // rail.md "When the rail opens on its own") — the top-bar button already
  // shows "Transcript"; a toast covers the case where nobody's watching.
  const notifiedDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "done" || !recordingId) return;
    if (notifiedDoneRef.current === recordingId) return;
    notifiedDoneRef.current = recordingId;
    if (!open) toast.info("Transcript ready.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recordingId]);

  const highlightAt = scrollTarget ?? atSeconds;
  useEffect(() => {
    if (phase !== "done" || highlightAt === null) return;
    highlightLineRef.current?.scrollIntoView({ block: "center" });
  }, [phase, highlightAt, lines.length]);

  // Enhance auto-preview (specs/meeting-notes-model.md §2): runs once, for
  // the owner, the moment the transcript lands with no plan yet — the sheet
  // is then ready the instant someone opens it, no 10-20s wait. Never applies.
  useEffect(() => {
    if (autoEnhanceTried.current) return;
    if (phase !== "done" || lines.length === 0 || enhanceNotes) return;
    if (!canEdit || (remote && !remote.ownerIsYou)) return;
    autoEnhanceTried.current = true;
    void generateEnhance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lines.length, enhanceNotes, canEdit, remote]);

  function openInApp(href: string) {
    try {
      (window.top ?? window).location.href = href;
    } catch {
      window.location.href = href;
    }
  }

  async function createRow(): Promise<StartRecordingResponse | null> {
    try {
      const res = await fetch("/api/meeting-recordings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentName, scheduledMeetingId, occurrenceStart }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.error === "alreadyRecording" && typeof json.recordingId === "string") {
        // Lost the race to someone else (or to this user's other device):
        // follow their recording instead of failing.
        claimed.current = true;
        setRecordingId(json.recordingId);
        setRemote({ ownerName: String(json.ownerName ?? "Someone"), ownerIsYou: Boolean(json.ownerIsYou) });
        setStartedAt(typeof json.since === "string" ? new Date(json.since).getTime() : Date.now());
        setCaptureMode("desktop");
        setPhase(json.status === "Pending" ? "starting" : json.status === "Processing" ? "processing" : json.status === "Stopped" ? "review" : "recording");
        return null;
      }
      if (!res.ok || typeof json?.id !== "string") {
        setError(describeStartError(json));
        return null;
      }
      return json as StartRecordingResponse;
    } catch {
      setError("Couldn't start recording.");
      return null;
    }
  }

  async function uploadChunk(
    id: string,
    channel: Channel,
    chunk: { segment: number; seq: number; buffer: ArrayBuffer },
  ): Promise<ChunkResponse> {
    const res = await fetch(
      `/api/meeting-recordings/${id}/chunks?channel=${channel}&segment=${chunk.segment}&seq=${chunk.seq}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "audio/pcm;rate=16000;channels=1" },
        body: chunk.buffer,
      },
    );
    if (res.status === 409) throw new ChunkConflictError();
    if (!res.ok) throw new Error(`chunk upload failed: ${res.status}`);
    return (await res.json()) as ChunkResponse;
  }

  function handleConflict() {
    if (conflictedRef.current) return;
    conflictedRef.current = true;
    teardownCapture();
    setError("Recording ended while this tab was in the background.");
    setPhase("processing");
  }

  function armChannel(id: string, channel: Channel, stream: MediaStream) {
    const queue = new ChunkUploadQueue((chunk) => uploadChunk(id, channel, chunk), {
      onStalled: () => setStalled((s) => ({ ...s, [channel]: true })),
      onResponse: (res) => {
        setStalled((s) => ({ ...s, [channel]: false }));
        if (res.stopRequested) void stop();
      },
      onConflict: handleConflict,
    });
    queues.current[channel] = queue;
    streams.current[channel] = stream;
    const capture = new WorkletCapture();
    captures.current[channel] = capture;
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (channel === "call") {
        capture.stop();
        queue.destroy();
        delete captures.current.call;
        delete queues.current.call;
        delete streams.current.call;
        setChannelsActive((chs) => chs.filter((c) => c !== "call"));
        toast.info("Call audio stopped. Still recording your microphone.");
      } else {
        void stop();
      }
    });
    return capture.start(
      stream,
      workletUrl,
      (buffer, seq) => queue.enqueue({ segment: segmentRef.current, seq, buffer }),
      (level) => setLevels((l) => ({ ...l, [channel]: level })),
    );
  }

  async function startDesktop() {
    setError(null);
    const created = await createRow();
    if (!created) {
      setOpen(true);
      return;
    }
    setRecordingId(created.id);
    setLink(created.link);
    setAiEnabled(created.aiEnabled);
    writeBackup(documentName, { id: created.id, link: created.link, aiEnabled: created.aiEnabled, captureMode: "desktop" });
    setCaptureMode("desktop");
    setAppUnreachable(false);
    setStartedAt(Date.now());
    setPhase("starting");
    openInApp(created.link);
  }

  async function startBrowser() {
    setError(null);
    const created = await createRow();
    if (!created) {
      setOpen(true);
      return;
    }
    setRecordingId(created.id);
    setLink(created.link);
    setAiEnabled(created.aiEnabled);
    writeBackup(documentName, { id: created.id, link: created.link, aiEnabled: created.aiEnabled, captureMode: "browser" });
    setCaptureMode("browser");
    segmentRef.current = 0;
    conflictedRef.current = false;

    let micStream: MediaStream;
    try {
      micStream = await openMic(micDeviceId);
    } catch (err) {
      setError(describeMicError(err));
      setOpen(true);
      void fetch(`/api/meeting-recordings/${created.id}`, { method: "DELETE", credentials: "include" }).catch(
        () => null,
      );
      setRecordingId(null);
      writeBackup(documentName, null);
      return;
    }
    const channels: Channel[] = ["mic"];
    await armChannel(created.id, "mic", micStream);

    if (callAudioWanted) {
      const callStream = await captureCallAudio().catch(() => null);
      if (!callStream) {
        setCallAudioUnsupported(true);
        toast.info("Call audio isn't available in this browser. Recording your microphone only.");
      } else {
        channels.push("call");
        await armChannel(created.id, "call", callStream);
      }
    }
    setChannelsActive(channels);
    setStartedAt(Date.now());
    setPhase("recording");
  }

  async function stop() {
    if (phase === "stopping" || phase === "processing" || phase === "review") return;
    setStoppingSince(Date.now());
    setPhase("stopping");
    if (captureMode === "browser") {
      const channels = Object.keys(captures.current) as Channel[];
      await Promise.all(channels.map((ch) => captures.current[ch]?.flush() ?? Promise.resolve()));
      await Promise.all(channels.map((ch) => queues.current[ch]?.drain(STOP_DRAIN_MS) ?? Promise.resolve()));
      setRecordedSeconds((s) => s + (Date.now() - startedAt) / 1000);
      teardownCapture();
    }
    if (!recordingId) return;
    await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => null);
    // Desktop capture: the app is still flushing its last chunks. Stay in
    // "stopping" until the poll sees the app's finish (Stopped), so Transcribe
    // can't dispatch a job that misses the mic channel.
    if (captureMode === "desktop") return;
    setPhase(conflictedRef.current ? "processing" : "review");
  }

  async function finishAndTranscribe() {
    if (!recordingId) return;
    setBusy(true);
    await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", final: true }),
    }).catch(() => null);
    setBusy(false);
    setPhase("processing");
  }

  // Try again after a failed dispatch: the audio is still on the server, so
  // ask it to process once more and go back to waiting.
  async function retryProcessing() {
    if (!recordingId) return;
    setError(null);
    const res = await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", final: true }),
    }).catch(() => null);
    if (!res?.ok) {
      setFinalized(true);
      setError("This recording can't be processed again. Record it again.");
      return;
    }
    setPhase("processing");
  }

  async function resume() {
    if (!recordingId) return;
    setError(null);
    const res = await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't continue recording.");
      return;
    }
    segmentRef.current += 1;
    if (captureMode === "desktop") {
      if (link) openInApp(link);
      setAppUnreachable(false);
      setStartedAt(Date.now());
      setPhase("starting");
      return;
    }
    try {
      const micStream = await openMic(micDeviceId);
      await armChannel(recordingId, "mic", micStream);
      const channels: Channel[] = ["mic"];
      if (callAudioWanted && !callAudioUnsupported) {
        const callStream = await captureCallAudio().catch(() => null);
        if (callStream) {
          channels.push("call");
          await armChannel(recordingId, "call", callStream);
        }
      }
      setChannelsActive(channels);
      setStartedAt(Date.now());
      setPhase("recording");
    } catch (err) {
      setError(describeMicError(err));
    }
  }

  async function discard() {
    const ok = await dialog.confirm({
      title: "Discard this recording?",
      description: "The transcript is deleted and can't be recovered. Insert it into the note first if you want to keep it.",
      confirmLabel: "Discard",
      tone: "destructive",
    });
    if (!ok) return;
    reset();
  }

  /** Inserts the markdown + transcript into the note. Unlike before the
   *  rail, this does NOT clear local state — the recording stays visible in
   *  the "inserted" state (specs/meeting-recording-rail.md) until Discard. */
  function insert(notes: string | null) {
    const paragraphs = transcriptParagraphs(lines, speakers, roster);
    if (!onInsert(meetingNotesMarkdown(notes), paragraphs)) {
      setError("The note is still loading. Try again in a moment.");
      return false;
    }
    if (recordingId) {
      void fetch(`/api/meeting-recordings/${recordingId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inserted" }),
      }).catch(() => null);
    }
    setInsertedAt(new Date().toISOString());
    return true;
  }

  // Whether the note still reads exactly as its seeded template did — drives
  // the Done panel's Write notes / Enhance notes label and the request's
  // untouchedTemplate flag (specs/meeting-notes-model.md §1, §2).
  function currentlyUntouched(): boolean {
    const state = getNoteState?.();
    if (!state) return false;
    return isUntouchedTemplate({ seededFromPageId, seededTemplateHash }, state.bodyText);
  }

  async function generateEnhance(): Promise<boolean> {
    if (!recordingId) return false;
    const state = getNoteState?.();
    if (!state) {
      setEnhanceError("The note is still loading. Try again in a moment.");
      return false;
    }
    setEnhanceBusy(true);
    setEnhanceError(null);
    try {
      const res = await fetch("/api/ai/meeting-notes/enhance", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          blocks: state.blocks,
          untouchedTemplate: isUntouchedTemplate({ seededFromPageId, seededTemplateHash }, state.bodyText),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.plan) {
        setEnhanceError(json?.error ?? "Couldn't generate notes.");
        return false;
      }
      setEnhanceNotes(json as StoredEnhanceNotes);
      return true;
    } catch {
      setEnhanceError("Couldn't generate notes.");
      return false;
    } finally {
      setEnhanceBusy(false);
    }
  }

  /** Opens the preview; generates (or regenerates, with forceRegenerate) only
   *  if nothing's already in flight, so auto-preview and a click racing each
   *  other don't fire two requests. The per-user consent confirm that used to
   *  gate this moved to a static sentence on the start sheet. */
  async function onEnhanceClick(forceRegenerate = false) {
    setEnhanceSheetOpen(true);
    setStalePreview(false);
    if (enhanceBusy) return;
    if (forceRegenerate) setEnhanceNotes(null);
    if (forceRegenerate || !enhanceNotes) void generateEnhance();
  }

  /** "Reload preview" on the stale-preview state: regenerates from the
   *  current text and the transcript, same as Enhance again. */
  function reloadStalePreview() {
    void onEnhanceClick(true);
  }

  /** Closes the preview (Cancel, in the "generating"/"preview" states) or the
   *  stale-preview notice (Cancel there too) without discarding anything. */
  function closeEnhancePreview() {
    setStalePreview(false);
    setEnhanceSheetOpen(false);
  }

  async function applyEnhance() {
    if (!recordingId || !enhanceNotes || !onApplyEnhance) return;
    setApplyBusy(true);
    setEnhanceError(null);
    try {
      const state = getNoteState?.();
      if (!state) {
        setEnhanceError("The note is still loading. Try again in a moment.");
        return;
      }
      await fetch("/api/collab/versions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: documentName, label: "Before enhance" }),
      }).catch(() => null);

      const lockRes = await fetch(`/api/meeting-recordings/${recordingId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enhanced", snapshotAt: enhanceNotes.snapshotAt }),
      });
      if (lockRes.status === 409) {
        setStalePreview(true);
        return;
      }
      const lockJson = await lockRes.json().catch(() => null);
      if (!lockRes.ok) {
        setEnhanceError(lockJson?.error ?? "Couldn't save.");
        return;
      }

      const untouched = isUntouchedTemplate({ seededFromPageId, seededTemplateHash }, state.bodyText);
      const { ops } = applyEnhancePlan(enhanceNotes.snapshot, state.blocks, enhanceNotes.plan, {
        untouchedTemplate: untouched,
      });
      const paragraphs = transcriptParagraphs(lines, speakers, roster);
      if (!onApplyEnhance(ops, recordingId, paragraphs, enhanceNotes.plan.actionItems)) {
        setEnhanceError("The note is still loading. Try again in a moment.");
        return;
      }

      setEnhancedAt(typeof lockJson?.enhancedAt === "string" ? lockJson.enhancedAt : new Date().toISOString());
      setEnhancedByName(typeof lockJson?.enhancedBy === "string" ? lockJson.enhancedBy : null);
      setEnhanceSheetOpen(false);
    } finally {
      setApplyBusy(false);
    }
  }

  // Action items into Tasks (specs/meeting-notes-model.md §4). Dedup and the
  // description link are the server's job; this just posts the checked rows,
  // folds the returned taskIds back into enhanceNotes so the sheet can mark
  // them "Task created", and tells the note to link the matching checklist
  // item (onTaskCreated — the client-side half of the mention/link decision).
  async function createTasksFromItems(
    items: { index: number; title: string; assigneeId?: string; dueAt?: string }[],
  ): Promise<boolean> {
    if (!recordingId || items.length === 0) return true;
    const res = await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createTasks", items }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    // A failure part-way through still reports the tasks it did create; mark
    // those so the rows read "Task created" and a retry sends only the rest.
    const created = (json?.created ?? []) as { index: number; taskId: string }[];
    const ok = Boolean(res?.ok);
    if (!ok) setEnhanceError(json?.error ?? "Couldn't create tasks.");
    if (created.length === 0) return ok;
    setEnhanceNotes((prev) => {
      if (!prev) return prev;
      const actionItems = prev.plan.actionItems.map((item, i) => {
        const hit = created.find((c) => c.index === i);
        return hit ? { ...item, taskId: hit.taskId } : item;
      });
      return { ...prev, plan: { ...prev.plan, actionItems } };
    });
    if (onTaskCreated && projectId) {
      for (const c of created) {
        const src = items.find((it) => it.index === c.index);
        if (src) onTaskCreated(src.title, c.taskId, projectId);
      }
    }
    return ok;
  }

  /** Renames a diarized speaker — to a roster member (`value` is their
   *  userId) or free text ("Someone else…"). Replaces the old
   *  dialog.choice/dialog.prompt pair: the rail's speaker chip (a Select
   *  over the roster plus an inline text field) resolves the value before
   *  calling this (specs/meeting-recording-rail.md). */
  async function setSpeaker(speakerKey: string, value: string) {
    if (!value.trim()) return;
    const next = { ...speakers, [speakerKey]: value };
    setSpeakers(next);
    if (!recordingId) return;
    const res = await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "speakers", speakers: { [speakerKey]: value } }),
    }).catch(() => null);
    if (!res?.ok) {
      setSpeakers(speakers);
      toast.error("Couldn't rename that speaker.");
    }
  }

  /** A citation chip's plain click (TranscriptChipHoverLayer): opens the rail
   *  and scrolls the transcript to `at`, highlighting the nearest line. */
  function jumpToTranscript(at: number) {
    setOpen(true);
    setScrollTarget(at);
  }

  // Backing out before anything was captured — nothing worth keeping.
  function cancelStart() {
    reset();
  }

  // The desktop app never answered the deep link: drop that row and reset to
  // the idle sheet with the browser radio selected, ready for Start recording.
  function switchToBrowserAfterUnreachable() {
    if (recordingId) {
      void fetch(`/api/meeting-recordings/${recordingId}`, { method: "DELETE", credentials: "include" }).catch(
        () => null,
      );
    }
    setRecordingId(null);
    writeBackup(documentName, null);
    setUseDesktopApp(false);
    setPhase("idle");
  }

  const hasTranscript = lines.length > 0;
  // Owner of this recording from this page, the same user following their
  // other device, or Core: who may stop/discard/transcribe it.
  const drives = !remote || remote.ownerIsYou;
  const canDiscard = canEdit && (drives || isCore);
  const stopStuck = phase === "stopping" && captureMode === "desktop" && stoppingSince > 0 && now - stoppingSince > STOP_WAIT_MS;
  // Both capture modes count locally while live; the server's recordedSeconds
  // only moves when a session finishes.
  const elapsed = phase === "recording" ? recordedSeconds + (now - startedAt) / 1000 : recordedSeconds;

  const micOptions = useMemo(
    () => micDevices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
    [micDevices],
  );

  const speakerCounts = countSpeakersByChannel(lines);
  const speakerKeys = useMemo(() => [...new Set(lines.filter((l) => l.speaker).map((l) => l.speaker!))], [lines]);
  const sortedLines = useMemo(() => [...lines].sort((a, b) => a.at - b.at), [lines]);
  const highlightLineIndex =
    highlightAt !== null && sortedLines.length > 0
      ? sortedLines.reduce(
          (best, l, i) => (best === -1 || Math.abs(l.at - highlightAt) < Math.abs(sortedLines[best]!.at - highlightAt) ? i : best),
          -1,
        )
      : -1;

  const canShowRecorder = canEdit || Boolean(transcriptParam);

  return {
    // Props passed through for convenience.
    canEdit,
    isCore,
    roster,
    projectId,
    canCreateTasks,
    getNoteState,
    seededFromPageId,
    seededTemplateHash,

    // Core state.
    phase,
    open,
    setOpen,
    recordingId,
    link,
    aiEnabled,
    captureMode,
    appUnreachable,
    desktopVer,
    channelsActive,
    levels,
    stalled,
    recordedSeconds,
    now,
    lines,
    speakers,
    error,
    busy,
    remote,
    insertedAt,
    finalized,
    stoppingSince,

    // Enhance state.
    enhanceNotes,
    enhancedAt,
    enhancedByName,
    enhanceSheetOpen,
    setEnhanceSheetOpen,
    enhanceBusy,
    enhanceError,
    applyBusy,
    stalePreview,

    // Start-sheet config.
    useDesktopApp,
    setUseDesktopApp,
    micDeviceId,
    setMicDeviceId,
    micDevices,
    micOptions,
    micLevel,
    micPreviewError,
    callAudioWanted,
    setCallAudioWanted,
    callAudioUnsupported,

    // Derived.
    live,
    hasTranscript,
    drives,
    canDiscard,
    stopStuck,
    elapsed,
    speakerCounts,
    speakerKeys,
    sortedLines,
    highlightLineIndex,
    highlightLineRef,
    canShowRecorder,
    transcriptParam,
    atSeconds,
    highlightAt,

    // Actions.
    startDesktop,
    startBrowser,
    stop,
    finishAndTranscribe,
    retryProcessing,
    resume,
    discard,
    insert,
    currentlyUntouched,
    generateEnhance,
    onEnhanceClick,
    reloadStalePreview,
    closeEnhancePreview,
    applyEnhance,
    createTasksFromItems,
    setSpeaker,
    jumpToTranscript,
    cancelStart,
    switchToBrowserAfterUnreachable,
  };
}

export type UseMeetingRecording = ReturnType<typeof useMeetingRecording>;
