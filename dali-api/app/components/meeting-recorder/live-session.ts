// The current user's live recording, held outside React so navigating the app
// (including desktop tab switches) never touches capture. Browser capture is
// owned here outright; a desktop recording is only tracked (the app captures).

import { useEffect, useSyncExternalStore } from "react";
import { stripAppTitle } from "~/lib/page-title";
import workletUrl from "./worklet-processor.js?url";
import { WorkletCapture } from "./capture";
import { ChunkConflictError, ChunkUploadQueue } from "./upload-queue";
import type { Channel, ChunkResponse, RecordingStatus } from "./types";

export type LiveSessionStatus = "starting" | "recording" | "stopping" | "stopped";

export type LiveSession = {
  recordingId: string;
  documentName: string;
  href: string | null;
  title: string;
  captureMode: "browser" | "desktop";
  status: LiveSessionStatus;
  startedAt: number;
  channelsActive: Channel[];
  levels: Record<Channel, number>;
  stalled: Record<Channel, boolean>;
  conflicted: boolean;
  stoppedSeconds: number | null;
};

type ActiveRecordingResponse = {
  recording: {
    id: string;
    documentName: string;
    status: RecordingStatus;
    title: string;
    href: string | null;
    sessionSeconds: number | null;
  } | null;
};

export const STOP_DRAIN_MS = 60_000;
export const POLL_MS = 10_000;
export const STOPPING_POLL_MS = 2_000;
const CLOCK_RESYNC_MS = 2_000;
const LEVEL_STEP = 0.05;

const emptyLevels: Record<Channel, number> = { mic: 0, call: 0 };
const emptyStalled: Record<Channel, boolean> = { mic: false, call: false };

let session: LiveSession | null = null;
const listeners = new Set<() => void>();

const captures: Partial<Record<Channel, WorkletCapture>> = {};
const streams: Partial<Record<Channel, MediaStream>> = {};
const queues: Partial<Record<Channel, ChunkUploadQueue>> = {};
let segment = 0;
let conflicted = false;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let inflightRefresh: Promise<void> | null = null;
let transitions = 0;
let bootRefreshed = false;
let unloadBound = false;

const recordingUrl = (id: string) => `/api/meeting-recordings/${id}`;

const hasCapture = () => Object.keys(captures).length > 0;
const isLive = (s: LiveSession | null) => s?.status === "starting" || s?.status === "recording" || s?.status === "stopping";

function emit() {
  listeners.forEach((l) => l());
}

function set(next: LiveSession | null) {
  if (next?.recordingId !== session?.recordingId || next?.status !== session?.status) transitions++;
  session = next;
  syncUnloadGuards();
  syncPoll();
  emit();
}

function patch(changes: Partial<LiveSession>) {
  if (session) set({ ...session, ...changes });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getLiveSession(): LiveSession | null {
  return session;
}

export function useLiveSession(): LiveSession | null {
  return useSyncExternalStore(subscribe, getLiveSession, () => null);
}

/** Refreshes once per page load, for whichever surface mounts first. */
export function useLiveSessionBoot(enabled: boolean) {
  useEffect(() => {
    if (!enabled || bootRefreshed) return;
    bootRefreshed = true;
    void refreshLiveSession();
  }, [enabled]);
}

function currentPage() {
  return {
    href: window.location.pathname,
    title: stripAppTitle(document.title) || "Untitled",
  };
}

export function liveSessionBlocker(documentName: string): { title: string; href: string | null; message: string } | null {
  if (!session || !isLive(session) || session.documentName === documentName) return null;
  return { title: session.title, href: session.href, message: `Stop the recording in ${session.title} first.` };
}

async function uploadChunk(
  id: string,
  channel: Channel,
  chunk: { segment: number; seq: number; buffer: ArrayBuffer },
): Promise<ChunkResponse> {
  const res = await fetch(`${recordingUrl(id)}/chunks?channel=${channel}&segment=${chunk.segment}&seq=${chunk.seq}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "audio/pcm;rate=16000;channels=1" },
    body: chunk.buffer,
  });
  if (res.status === 409) throw new ChunkConflictError();
  if (!res.ok) throw new Error(`chunk upload failed: ${res.status}`);
  return (await res.json()) as ChunkResponse;
}

function teardownCapture() {
  for (const ch of Object.keys(captures) as Channel[]) {
    captures[ch]?.stop();
    queues[ch]?.destroy();
    streams[ch]?.getTracks().forEach((t) => t.stop());
    delete captures[ch];
    delete queues[ch];
    delete streams[ch];
  }
  syncUnloadGuards();
}

function handleConflict() {
  if (conflicted) return;
  conflicted = true;
  teardownCapture();
  patch({ conflicted: true, status: "stopped", stoppedSeconds: null, channelsActive: [], levels: emptyLevels, stalled: emptyStalled });
}

function setLevel(channel: Channel, level: number) {
  if (!session) return;
  const rounded = Math.round(level / LEVEL_STEP) * LEVEL_STEP;
  if (session.levels[channel] === rounded) return;
  patch({ levels: { ...session.levels, [channel]: rounded } });
}

function setStalled(channel: Channel, value: boolean) {
  if (!session || session.stalled[channel] === value) return;
  patch({ stalled: { ...session.stalled, [channel]: value } });
}

function armChannel(id: string, channel: Channel, stream: MediaStream, onCallAudioEnded?: () => void) {
  const queue = new ChunkUploadQueue((chunk) => uploadChunk(id, channel, chunk), {
    onStalled: () => setStalled(channel, true),
    onResponse: (res) => {
      setStalled(channel, false);
      if (res.stopRequested) void stopLiveSession();
    },
    onConflict: handleConflict,
  });
  queues[channel] = queue;
  streams[channel] = stream;
  const capture = new WorkletCapture();
  captures[channel] = capture;
  stream.getAudioTracks()[0]?.addEventListener("ended", () => {
    if (channel === "call") {
      capture.stop();
      queue.destroy();
      delete captures.call;
      delete queues.call;
      delete streams.call;
      if (session) patch({ channelsActive: session.channelsActive.filter((c) => c !== "call") });
      onCallAudioEnded?.();
    } else {
      void stopLiveSession();
    }
  });
  return capture.start(
    stream,
    workletUrl,
    (buffer, seq) => queue.enqueue({ segment, seq, buffer }),
    (level) => setLevel(channel, level),
  );
}

export async function startBrowserSession(opts: {
  recordingId: string;
  documentName: string;
  micStream: MediaStream;
  callStream?: MediaStream | null;
  segment: number;
  onCallAudioEnded?: () => void;
}): Promise<number> {
  segment = opts.segment;
  conflicted = false;
  const page = currentPage();
  set({
    recordingId: opts.recordingId,
    documentName: opts.documentName,
    href: page.href,
    title: page.title,
    captureMode: "browser",
    status: "starting",
    startedAt: Date.now(),
    channelsActive: [],
    levels: emptyLevels,
    stalled: emptyStalled,
    conflicted: false,
    stoppedSeconds: null,
  });
  const channels: Channel[] = ["mic"];
  try {
    await armChannel(opts.recordingId, "mic", opts.micStream, opts.onCallAudioEnded);
    if (opts.callStream) {
      channels.push("call");
      await armChannel(opts.recordingId, "call", opts.callStream, opts.onCallAudioEnded);
    }
  } catch (err) {
    teardownCapture();
    opts.micStream.getTracks().forEach((t) => t.stop());
    opts.callStream?.getTracks().forEach((t) => t.stop());
    set(null);
    throw err;
  }
  const startedAt = Date.now();
  patch({ status: "recording", startedAt, channelsActive: channels });
  void refreshLiveSession();
  return startedAt;
}

export function adoptDesktopSession(opts: {
  recordingId: string;
  documentName: string;
  status: "starting" | "recording";
  startedAt: number;
}) {
  const page = currentPage();
  set({
    recordingId: opts.recordingId,
    documentName: opts.documentName,
    href: page.href,
    title: page.title,
    captureMode: "desktop",
    status: opts.status,
    startedAt: opts.startedAt,
    channelsActive: [],
    levels: emptyLevels,
    stalled: emptyStalled,
    conflicted: false,
    stoppedSeconds: null,
  });
  void refreshLiveSession();
}

export function clearLiveSession(recordingId: string) {
  if (!session || session.recordingId !== recordingId) return;
  teardownCapture();
  set(null);
}

/** Tears everything down regardless of which recording it is. */
export function resetLiveSession() {
  teardownCapture();
  bootRefreshed = false;
  set(null);
}

export async function stopLiveSession(): Promise<void> {
  const s = session;
  if (!s || s.status === "stopping" || s.status === "stopped") return;
  patch({ status: "stopping" });

  if (s.captureMode === "browser" && hasCapture()) {
    const channels = Object.keys(captures) as Channel[];
    await Promise.all(channels.map((ch) => captures[ch]?.flush() ?? Promise.resolve()));
    await Promise.all(channels.map((ch) => queues[ch]?.drain(STOP_DRAIN_MS) ?? Promise.resolve()));
    const seconds = (Date.now() - s.startedAt) / 1000;
    teardownCapture();
    if (session?.recordingId !== s.recordingId || conflicted) return;
    await fetch(recordingUrl(s.recordingId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", seconds }),
    }).catch(() => null);
    if (session?.recordingId !== s.recordingId) return;
    patch({ status: "stopped", stoppedSeconds: seconds, channelsActive: [], levels: emptyLevels, stalled: emptyStalled });
    return;
  }

  await fetch(recordingUrl(s.recordingId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop" }),
  }).catch(() => null);
  syncPoll(true);
}

const SERVER_STATUS: Partial<Record<RecordingStatus, LiveSessionStatus>> = {
  Pending: "starting",
  Recording: "recording",
  Stopped: "stopped",
};

function reconcile(recording: ActiveRecordingResponse["recording"]) {
  const s = session;
  if (!recording) {
    if (s && !(s.captureMode === "browser" && isLive(s))) set(null);
    return;
  }
  const serverStatus = SERVER_STATUS[recording.status];
  if (!serverStatus) return;
  const serverStart = typeof recording.sessionSeconds === "number" ? Date.now() - recording.sessionSeconds * 1000 : null;

  if (s && s.recordingId === recording.id) {
    const changes: Partial<LiveSession> = { title: recording.title, href: recording.href };
    if (!(s.captureMode === "browser" && isLive(s))) {
      if (!(s.status === "stopping" && serverStatus !== "stopped")) changes.status = serverStatus;
      if (serverStart !== null && Math.abs(s.startedAt - serverStart) > CLOCK_RESYNC_MS) changes.startedAt = serverStart;
    }
    set({ ...s, ...changes });
    return;
  }
  if (s && s.captureMode === "browser" && isLive(s)) return;
  set({
    recordingId: recording.id,
    documentName: recording.documentName,
    href: recording.href,
    title: recording.title,
    captureMode: "desktop",
    status: serverStatus,
    startedAt: serverStart ?? Date.now(),
    channelsActive: [],
    levels: emptyLevels,
    stalled: emptyStalled,
    conflicted: false,
    stoppedSeconds: null,
  });
}

export function refreshLiveSession(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  inflightRefresh ??= (async () => {
    const seen = transitions;
    try {
      const res = await fetch("/api/meeting-recordings/active", { credentials: "include" }).catch(() => null);
      if (!res?.ok) return;
      const json = (await res.json().catch(() => null)) as ActiveRecordingResponse | null;
      if (seen === transitions) reconcile(json?.recording ?? null);
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

function syncPoll(restart = false) {
  if (restart && pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (!session) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    return;
  }
  if (pollTimer) return;
  pollTimer = setTimeout(
    async () => {
      pollTimer = null;
      await refreshLiveSession();
      syncPoll();
    },
    session.status === "stopping" ? STOPPING_POLL_MS : POLL_MS,
  );
}

function preventUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
}

function finishOnPageHide() {
  const s = session;
  if (!s || s.captureMode !== "browser" || !isLive(s)) return;
  void fetch(recordingUrl(s.recordingId), {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finish", seconds: (Date.now() - s.startedAt) / 1000 }),
  }).catch(() => null);
}

function syncUnloadGuards() {
  if (typeof window === "undefined") return;
  const want = session?.captureMode === "browser" && hasCapture();
  if (want && !unloadBound) {
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("pagehide", finishOnPageHide);
    unloadBound = true;
  } else if (!want && unloadBound) {
    window.removeEventListener("beforeunload", preventUnload);
    window.removeEventListener("pagehide", finishOnPageHide);
    unloadBound = false;
  }
}
