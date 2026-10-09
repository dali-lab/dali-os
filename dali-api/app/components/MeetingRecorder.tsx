import { useEffect, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { Download, Mic, Monitor, Square, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Select, Tooltip, type SelectOption } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { Radio } from "~/components/ui/Radio";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { desktopVersion } from "~/lib/desktop";
import { acquireCollabDoc, releaseCollabDoc } from "~/components/doc/collab-doc";
// Vite explicit-URL import: the worklet runs in AudioWorkletGlobalScope and
// is loaded via audioWorklet.addModule(url), so it has to resolve to a real
// URL rather than being bundled as a normal module (see worklet-processor.js
// for why it can't import anything, including this app's own bundler output).
import workletUrl from "./meeting-recorder/worklet-processor.js?url";
import {
  captureCallAudio,
  describeMicError,
  listMicDevices,
  openMic,
  startLevelMeter,
  WorkletCapture,
} from "./meeting-recorder/capture";
import { ChunkConflictError, ChunkUploadQueue } from "./meeting-recorder/upload-queue";
import {
  countSpeakersByChannel,
  formatClock,
  meetingNotesMarkdown,
  speakerLabelFor,
  transcriptParagraphs,
} from "./meeting-recorder/transcript";
import type {
  Channel,
  ChunkResponse,
  PollRecordingResponse,
  RecordingStatus,
  RosterUser,
  Speakers,
  StartRecordingResponse,
  TranscriptLine,
} from "./meeting-recorder/types";

type Phase =
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

type CaptureMode = "browser" | "desktop" | null;

const POLL_MS = 3000;
const APP_WAIT_MS = 30_000;
const STOP_DRAIN_MS = 60_000;

type Backup = { id: string; link: string; aiEnabled: boolean };
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
  return code ?? "Couldn't start recording.";
}

const emptyLevels: Record<Channel, number> = { mic: 0, call: 0 };
const emptyStalled: Record<Channel, boolean> = { mic: false, call: false };

/**
 * The Record button in a Drive document's top bar. A sheet picks the
 * capture source (this browser's mic/call audio, or "everything on this
 * Mac" via the DALI OS desktop app); while live it's a pill with a timer and
 * level meter; on stop the transcript is batch-processed server-side
 * (Parakeet + pyannote on Modal) and the page polls until it's done, then
 * shows You/Others + diarized speaker chips, renameable to the occurrence
 * roster. See specs/meeting-transcription.md.
 */
export function MeetingRecorder({
  documentName,
  scheduledMeetingId,
  occurrenceStart,
  roster = [],
  canEdit,
  onInsert,
  autoOpen,
  collabToken,
}: {
  /** The collab room the notes land in. */
  documentName: string;
  scheduledMeetingId?: string;
  occurrenceStart?: string;
  /** The occurrence's attendees, for the speaker-rename chips. */
  roster?: RosterUser[];
  canEdit: boolean;
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
}) {
  const { actionBtnPrimary, actionIcon } = useOsChrome();
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

  // ─── Pick a left-behind recording back up ──────────────────────────────
  useEffect(() => {
    if (claimed.current) return;
    const saved = readBackup(documentName) ?? (transcriptParam ? { id: transcriptParam, link: "", aiEnabled: false } : null);
    if (!saved) return;
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
      if (data.error) setError(data.error);
      if (data.status === "Pending" || data.status === "Recording") {
        setCaptureMode("desktop"); // reconnected after a reload: local capture, if any, is gone
        setStartedAt(Date.now() - data.recordedSeconds * 1000);
        setPhase(data.status === "Pending" ? "starting" : "recording");
        setOpen(true);
      } else if (data.status === "Stopped") {
        setPhase("review");
        setOpen(true);
      } else if (data.status === "Processing") {
        setPhase("processing");
        setOpen(true);
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

  // ─── Elapsed-time tick while locally timing (browser capture) ──────────
  useEffect(() => {
    if (phase !== "recording" || captureMode !== "browser") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase, captureMode]);

  // ─── Desktop deep-link liveness poll (no local capture to time by) ─────
  useEffect(() => {
    if (captureMode !== "desktop" || !recordingId) return;
    if (phase !== "starting" && phase !== "recording") return;
    let cancelled = false;
    const createdAt = Date.now();
    async function tick() {
      const res = await fetch(`/api/meeting-recordings/${recordingId}`, { credentials: "include" }).catch(
        () => null,
      );
      if (cancelled || !res?.ok) return;
      const data = (await res.json()) as PollRecordingResponse;
      if (cancelled) return;
      setChannelsActive(data.channels as Channel[]);
      setRecordedSeconds(data.recordedSeconds);
      if (data.status === "Recording") {
        setAppUnreachable(false);
        setPhase((p) => (p === "starting" ? "recording" : p));
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
      if (cancelled || !res?.ok) return;
      const data = (await res.json()) as PollRecordingResponse;
      if (cancelled) return;
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

  useEffect(() => {
    if (phase === "done" || phase === "failed") setOpen(true);
  }, [phase]);

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
    writeBackup(documentName, { id: created.id, link: created.link, aiEnabled: created.aiEnabled });
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
    writeBackup(documentName, { id: created.id, link: created.link, aiEnabled: created.aiEnabled });
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
    clearLocalState();
    return true;
  }

  async function writeNotes() {
    if (!recordingId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/meeting-notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentName, recordingId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.markdown !== "string") {
        setError(json?.error ?? "Couldn't write notes. You can still add the transcript.");
        setBusy(false);
        return;
      }
      if (!insert(json.markdown)) setBusy(false);
    } catch {
      setError("Couldn't write notes. You can still add the transcript.");
      setBusy(false);
    }
  }

  async function renameSpeaker(speakerKey: string) {
    const options = [...roster.map((r) => ({ value: r.userId, label: r.name })), { value: "__other__", label: "Someone else…" }];
    const choice = await dialog.choice({
      title: "Who is this?",
      options,
    });
    if (!choice) return;
    let value = choice;
    if (choice === "__other__") {
      const text = await dialog.prompt({ title: "Speaker's name", label: "Name", placeholder: "e.g. a guest" });
      if (!text?.trim()) return;
      value = text.trim();
    }
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

  // Backing out before anything was captured — nothing worth keeping.
  function cancelStart() {
    reset();
  }

  const hasTranscript = lines.length > 0;
  const elapsed =
    captureMode === "browser" && phase === "recording" ? recordedSeconds + (now - startedAt) / 1000 : recordedSeconds;

  const micOptions: SelectOption[] = micDevices.map((d, i) => ({
    value: d.deviceId,
    label: d.label || `Microphone ${i + 1}`,
  }));

  const statusLine =
    phase === "idle"
      ? null
      : phase === "starting"
        ? captureMode === "desktop"
          ? appUnreachable
            ? "The DALI OS app didn't respond."
            : "Opening the DALI OS app…"
          : "Starting…"
        : phase === "recording"
          ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {formatClock(elapsed)}
              </span>
            )
          : phase === "stopping"
            ? "Stopping…"
            : phase === "review"
              ? `${formatClock(recordedSeconds)} recorded`
              : phase === "processing"
                ? "Transcribing…"
                : phase === "done"
                  ? `${formatClock(Math.max(recordedSeconds, ...lines.map((l) => l.end), 0))} recorded`
                  : "Recording failed";

  // ─── Done panel's speaker chips ─────────────────────────────────────────
  const speakerCounts = countSpeakersByChannel(lines);
  const speakerKeys = [...new Set(lines.filter((l) => l.speaker).map((l) => l.speaker!))];

  function speakerChip(key: string) {
    const line = lines.find((l) => l.speaker === key);
    const label = line ? speakerLabelFor(line, speakerCounts, speakers, roster) : key;
    if (!canEdit) return <span key={key} className="rounded-full bg-os-container px-2 py-0.5 text-xs">{label}</span>;
    return (
      <button
        key={key}
        type="button"
        onClick={() => void renameSpeaker(key)}
        className="rounded-full border border-os-container px-2 py-0.5 text-xs text-foreground hover:border-os-container-hi"
      >
        {label}
      </button>
    );
  }

  const canShowRecorder = canEdit || Boolean(transcriptParam);
  if (!canShowRecorder) return null;

  const triggerLabel = phase === "idle" ? (canEdit ? "Record" : "Transcript") : "Show recording";

  return (
    <>
      <Tooltip content={triggerLabel}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={triggerLabel}
          className={cn(
            actionBtnPrimary,
            (phase === "recording" || phase === "stopping") &&
              "border-accent-coral bg-accent-coral text-navy-deep hover:border-accent-coral-light hover:bg-accent-coral-light",
          )}
        >
          <Mic className={actionIcon} />
          {phase === "idle" ? (
            <span className="hidden sm:inline">{triggerLabel}</span>
          ) : phase === "recording" ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {formatClock(elapsed)}
            </>
          ) : (
            <span className="hidden sm:inline">{triggerLabel}</span>
          )}
        </button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="meeting-recorder-title"
        containerClassName={modalCardClass("max-w-lg")}
      >
        <ModalHeader
          titleId="meeting-recorder-title"
          title={
            phase === "idle"
              ? "Record this meeting"
              : phase === "recording"
                ? "Recording"
                : phase === "processing"
                  ? "Transcribing"
                  : phase === "done"
                    ? "Transcript"
                    : phase === "failed"
                      ? "Recording failed"
                      : "Recording"
          }
          subtitle={statusLine}
          onClose={() => setOpen(false)}
          className="mb-4"
        />

        {phase === "idle" && canEdit && (
          <div className="flex flex-col gap-4">
            {desktopVer != null && (
              <div
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  useDesktopApp ? "border-os-accent bg-os-accent/10" : "border-os-container",
                )}
              >
                <Radio
                  name="capture-mode"
                  checked={useDesktopApp}
                  onChange={() => setUseDesktopApp(true)}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Monitor className="h-3.5 w-3.5" /> Capture everything on this Mac with the DALI OS app
                    </span>
                  }
                  description="Records system audio (everyone on the call) and your mic."
                />
              </div>
            )}
            {desktopVer != null && (
              <div
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  !useDesktopApp ? "border-os-accent bg-os-accent/10" : "border-os-container",
                )}
              >
                <Radio
                  name="capture-mode"
                  checked={!useDesktopApp}
                  onChange={() => setUseDesktopApp(false)}
                  label="Record in this browser instead"
                />
              </div>
            )}

            {!useDesktopApp && (
              <div className="flex flex-col gap-3 rounded-xl bg-os-well p-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Microphone</span>
                  {micPreviewError ? (
                    <p className="text-xs text-red-700">{micPreviewError}</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select
                        value={micDeviceId}
                        onChange={setMicDeviceId}
                        options={micOptions}
                        placeholder="Default microphone"
                        ariaLabel="Microphone"
                      />
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-os-container">
                        <div
                          className="h-full rounded-full bg-os-accent transition-[width]"
                          style={{ width: `${Math.round(micLevel * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {desktopVer == null &&
                  (callAudioUnsupported ? (
                    <p className="text-xs text-muted-foreground">
                      This browser can't capture call audio; the recording will use your microphone only.
                    </p>
                  ) : (
                    <Toggle
                      checked={callAudioWanted}
                      onChange={(e) => setCallAudioWanted(e.target.checked)}
                      label="Include call audio from a browser tab"
                      description="Shares a tab, window, or screen; only the audio is kept."
                    />
                  ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Everyone in the meeting should know it's being recorded. A recording badge shows on this note while it
              runs. Don't record meetings where patient, student record, or other protected information will be
              discussed.
            </p>
          </div>
        )}

        {(phase === "starting" || phase === "recording" || phase === "stopping") && (
          <RecordingLiveBody
            captureMode={captureMode}
            channelsActive={channelsActive}
            levels={levels}
            stalled={stalled}
            appUnreachable={appUnreachable && phase === "starting"}
          />
        )}

        {phase === "review" && (
          <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
            <p>Stopped. Add another session, or finish to transcribe what was recorded.</p>
          </div>
        )}

        {phase === "processing" && (
          <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-muted-foreground">
            Transcribing and labeling speakers, usually a few minutes.
          </p>
        )}

        {(phase === "done" || phase === "failed") && (
          <div className="flex flex-col gap-3">
            {phase === "failed" ? (
              <p className="text-sm text-red-700">{error ?? "Transcription failed. Try recording again."}</p>
            ) : (
              <>
                {hasTranscript && speakerKeys.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">{speakerKeys.map(speakerChip)}</div>
                )}
                <div className="max-h-72 overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed">
                  {!hasTranscript ? (
                    <p className="text-muted-foreground">Nothing was transcribed.</p>
                  ) : (
                    [...lines]
                      .sort((a, b) => a.at - b.at)
                      .map((l, i) => (
                        <p key={i} className="text-foreground">
                          <span className="mr-2 font-mono text-[11px] text-muted-foreground">{formatClock(l.at)}</span>
                          <span className="mr-1 font-medium text-muted-foreground">
                            {speakerLabelFor(l, speakerCounts, speakers, roster)}:
                          </span>
                          {l.text}
                        </p>
                      ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {error && phase !== "failed" && <p className="mt-2 text-xs text-red-700">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-1.5">
          {phase === "idle" && canEdit && (
            <button
              type="button"
              onClick={() => void (useDesktopApp ? startDesktop() : startBrowser())}
              className={buttonClasses("primary", "sm")}
            >
              <Mic className="h-3.5 w-3.5" /> Start recording
            </button>
          )}
          {phase === "starting" && appUnreachable && (
            <>
              <IconButton label="Cancel" icon={Trash2} tone="destructive" onClick={cancelStart} />
              <a href="/download" className={buttonClasses("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Get the app
              </a>
              <button
                type="button"
                onClick={() => {
                  void fetch(`/api/meeting-recordings/${recordingId}`, {
                    method: "DELETE",
                    credentials: "include",
                  }).catch(() => null);
                  setRecordingId(null);
                  writeBackup(documentName, null);
                  setUseDesktopApp(false);
                  setPhase("idle");
                }}
                className={buttonClasses("primary", "sm")}
              >
                Record in this browser instead
              </button>
            </>
          )}
          {phase === "starting" && !appUnreachable && captureMode === "browser" && (
            <button type="button" onClick={cancelStart} className={buttonClasses("secondary", "sm")}>
              Cancel
            </button>
          )}
          {(phase === "recording" || phase === "stopping") && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={phase === "stopping"}
              className={buttonClasses("secondary", "sm")}
            >
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
          {phase === "review" && canEdit && (
            <>
              <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void discard()} />
              <button type="button" onClick={() => void resume()} className={buttonClasses("secondary", "sm")}>
                <Mic className="h-3.5 w-3.5" /> Continue
              </button>
              <button type="button" onClick={() => void finishAndTranscribe()} className={buttonClasses("primary", "sm")}>
                Transcribe
              </button>
            </>
          )}
          {phase === "done" && canEdit && (
            <>
              <IconButton
                label="Discard recording"
                icon={Trash2}
                tone="destructive"
                onClick={() => void discard()}
                disabled={busy}
              />
              {aiEnabled && hasTranscript && (
                <button
                  type="button"
                  onClick={() => insert(null)}
                  disabled={busy}
                  className={buttonClasses("secondary", "sm")}
                >
                  Insert transcript
                </button>
              )}
              <button
                type="button"
                onClick={aiEnabled ? () => void writeNotes() : () => insert(null)}
                disabled={!hasTranscript || busy}
                className={buttonClasses("primary", "sm")}
              >
                {!aiEnabled ? "Insert transcript" : busy ? "Writing notes…" : "Write notes"}
              </button>
            </>
          )}
          {phase === "failed" && canEdit && (
            <>
              <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void discard()} />
              <button type="button" onClick={() => void resume()} className={buttonClasses("primary", "sm")}>
                Try again
              </button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

function RecordingLiveBody({
  captureMode,
  channelsActive,
  levels,
  stalled,
  appUnreachable,
}: {
  captureMode: CaptureMode;
  channelsActive: Channel[];
  levels: Record<Channel, number>;
  stalled: Record<Channel, boolean>;
  appUnreachable: boolean;
}) {
  if (appUnreachable) {
    return (
      <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
        Update the DALI OS app to record, or record in this browser instead.
      </p>
    );
  }
  const channelLabel: Record<Channel, string> = { mic: "Microphone", call: "Call audio" };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3">
      <p className="text-sm text-foreground">
        Recording. The transcript appears a few minutes after you stop.
      </p>
      {captureMode === "browser" && channelsActive.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {channelsActive.map((ch) => (
            <li key={ch} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{channelLabel[ch]}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-os-container">
                <div
                  className="h-full rounded-full bg-os-accent transition-[width]"
                  style={{ width: `${Math.round((levels[ch] ?? 0) * 100)}%` }}
                />
              </div>
              {stalled[ch] && <span className="text-xs text-red-700">Upload stalled</span>}
            </li>
          ))}
        </ul>
      )}
      {captureMode === "desktop" && (
        <p className="text-xs text-muted-foreground">Recording via the DALI OS app.</p>
      )}
    </div>
  );
}
