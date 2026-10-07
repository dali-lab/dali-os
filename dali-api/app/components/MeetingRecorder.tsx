import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { Mic, Square, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  SOURCE_LABEL,
  formatClock,
  meetingNotesMarkdown,
  transcriptParagraphs,
  transcriptText,
  type TranscriptLine,
} from "~/lib/meeting-transcript";

type Phase = "idle" | "starting" | "unreachable" | "recording" | "stopping" | "review" | "writing";

type PollResponse = {
  status: "Pending" | "Recording" | "Stopped" | "Failed";
  systemAudio: boolean;
  recordedSeconds: number;
  error: string | null;
  total: number;
  lines: TranscriptLine[];
};

const POLL_MS = 1500;
// How long a fresh recording may sit unclaimed before we assume the desktop
// app isn't installed or didn't open.
const APP_WAIT_MS = 10_000;
// After Stop, how long to wait for the app to confirm before settling for the
// lines we already have (the app may have quit mid-recording).
const STOP_WAIT_MS = 20_000;

// Which recording this document has open, so a page that reloads, closes or
// crashes mid-recording finds it again. The transcript itself stays on the
// server; this only remembers where to look.
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

// A button in the top bar of every Drive document the viewer can edit; the
// transcript and the review step live in a dialog it opens, meeting notes
// included (documents.$pageId, behind the `ai-meeting-notes` flag). Recording
// always happens in the DALI OS desktop app, whichever window started it: the
// page creates a recording and
// opens its dalios:// link, the app captures the Mac's system audio (everyone
// on a call) plus the mic and transcribes on-device, and the page polls the
// lines through the server. On stop, /api/ai/meeting-notes turns them into
// notes appended to the doc through the live editor.
export function MeetingRecorder({
  documentName,
  onInsert,
}: {
  /** The collab room the notes land in. */
  documentName: string;
  /** Appends the notes Markdown, then the transcript lines under a collapsed
   *  toggle heading. False when the editor isn't ready. */
  onInsert: (markdown: string, transcript: string[]) => boolean;
}) {
  const { actionBtnPrimary, actionIcon } = useOsChrome();
  const [phase, setPhase] = useState<Phase>("idle");
  // The dialog is optional while recording, but these two steps need an answer.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (phase === "review" || phase === "unreachable") setOpen(true);
  }, [phase]);
  const dialog = useDialog();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // From the server: without an AI provider the recording lands as a
  // transcript only.
  const [aiEnabled, setAiEnabled] = useState(false);
  // Seconds from earlier sessions of this recording (Stop, then Continue).
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [systemAudio, setSystemAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stopAskedAt = useRef(0);
  // Lines already fetched. Kept across Continue so a new session only pulls
  // what's new.
  const since = useRef(0);

  const live = phase === "starting" || phase === "recording" || phase === "stopping";

  // Pick a left-behind recording back up: still running, it carries on here;
  // stopped or failed, it opens for review with everything it transcribed.
  const claimed = useRef(false);
  useEffect(() => {
    const saved = readBackup(documentName);
    if (!saved) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/meeting-recordings/${saved.id}`, {
        credentials: "include",
      }).catch(() => null);
      if (cancelled || claimed.current || !res) return;
      if (!res.ok) {
        if (res.status === 404) writeBackup(documentName, null);
        return;
      }
      const data = (await res.json()) as PollResponse;
      if (cancelled || claimed.current) return;
      claimed.current = true;
      if (data.status !== "Recording" && data.total === 0) {
        // Never picked up, or nothing was said: not worth bringing back.
        void fetch(`/api/meeting-recordings/${saved.id}`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => null);
        writeBackup(documentName, null);
        return;
      }
      setRecordingId(saved.id);
      setLink(saved.link);
      setAiEnabled(saved.aiEnabled);
      since.current = data.total;
      setLines(data.lines);
      setSystemAudio(data.systemAudio);
      setRecordedSeconds(data.recordedSeconds);
      if (data.status === "Recording") {
        const last = Math.max(data.recordedSeconds, ...data.lines.map((l) => l.at));
        setStartedAt(Date.now() - (last - data.recordedSeconds) * 1000);
        setPhase("recording");
      } else {
        if (data.error) setError(data.error);
        setPhase("review");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentName]);

  // Leaving mid-recording: the browser's own prompt covers closing or reloading
  // the tab, and the blocker covers moving to another page inside the app.
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
          "The recording keeps running in the DALI OS app. Come back to this note to stop it and add the notes.",
        confirmLabel: "Leave",
        cancelLabel: "Stay",
      })
      .then((leave) => (leave ? blocker.proceed() : blocker.reset()));
    // Keyed on the blocker's state; `dialog` is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // Poll the transcript while the app is (or should be) recording.
  useEffect(() => {
    if (!recordingId || !live) return;
    let cancelled = false;
    const created = Date.now();
    async function tick() {
      const from = since.current;
      try {
        const res = await fetch(`/api/meeting-recordings/${recordingId}?since=${from}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("Lost track of the recording.");
          setPhase("review");
          return;
        }
        const data = (await res.json()) as PollResponse;
        if (cancelled) return;
        // A slow poll can overlap the next one; keep only lines past what an
        // earlier response already added.
        if (data.total > since.current) {
          const fresh = data.lines.slice(since.current - from);
          setLines((prev) => [...prev, ...fresh]);
          since.current = data.total;
        }
        setSystemAudio(data.systemAudio);
        setRecordedSeconds(data.recordedSeconds);
        if (data.status === "Recording") {
          setPhase((p) => (p === "starting" ? "recording" : p));
        } else if (data.status === "Stopped" || data.status === "Failed") {
          if (data.error) setError(data.error);
          setPhase("review");
          return;
        } else if (Date.now() - created > APP_WAIT_MS) {
          setPhase((p) => (p === "starting" ? "unreachable" : p));
        }
        if (stopAskedAt.current && Date.now() - stopAskedAt.current > STOP_WAIT_MS) {
          setPhase("review");
        }
      } catch {
        // A dropped poll just retries on the next tick.
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Keyed on the id and liveness only; `since` lives in a ref across re-arms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, live]);

  useEffect(() => {
    if (phase !== "recording") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, open]);

  function openInApp(link: string) {
    try {
      // Top frame: a workspace tab is an iframe, and the desktop shell only
      // watches its main frame's navigations.
      (window.top ?? window).location.href = link;
    } catch {
      window.location.href = link;
    }
  }

  async function start() {
    claimed.current = true;
    if (recordingId) reset();
    setError(null);
    try {
      const res = await fetch("/api/meeting-recordings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentName }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.id !== "string") {
        setError(json?.error ?? "Couldn't start recording.");
        setOpen(true);
        return;
      }
      setAiEnabled(json.aiEnabled === true);
      setRecordingId(json.id);
      writeBackup(documentName, { id: json.id, link: json.link, aiEnabled: json.aiEnabled === true });
      setLink(json.link);
      setStartedAt(Date.now());
      setPhase("starting");
      openInApp(json.link);
    } catch {
      setError("Couldn't start recording.");
      setOpen(true);
    }
  }

  async function stop() {
    if (!recordingId) return;
    stopAskedAt.current = Date.now();
    setPhase("stopping");
    await fetch(`/api/meeting-recordings/${recordingId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => null);
  }

  // Continue: record another session into the same transcript.
  async function resume() {
    if (!recordingId || !link) return;
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
    stopAskedAt.current = 0;
    setStartedAt(Date.now());
    setPhase("starting");
    openInApp(link);
  }

  // Backing out before the app picks up. A continued recording keeps what it
  // already has; a brand-new one has nothing worth keeping.
  function cancelStart() {
    if (lines.length > 0) void stop();
    else reset();
  }

  function reset() {
    if (recordingId) {
      void fetch(`/api/meeting-recordings/${recordingId}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => null);
    }
    setRecordingId(null);
    writeBackup(documentName, null);
    setLink(null);
    setRecordedSeconds(0);
    stopAskedAt.current = 0;
    since.current = 0;
    setLines([]);
    setError(null);
    setPhase("idle");
    setOpen(false);
  }

  // Discarding from the review step throws away a transcript that already
  // exists, unlike the resets that run before a recording has anything in it.
  async function discard() {
    const ok = await dialog.confirm({
      title: "Discard this recording?",
      description:
        "The transcript is deleted and can't be recovered. Insert it into the note first if you want to keep it.",
      confirmLabel: "Discard",
      tone: "destructive",
    });
    if (!ok) return;
    reset();
  }

  function insert(notes: string | null) {
    if (!onInsert(meetingNotesMarkdown(notes), transcriptParagraphs(lines))) {
      setError("The note is still loading. Try again in a moment.");
      return false;
    }
    reset();
    return true;
  }

  async function writeNotes() {
    setPhase("writing");
    setError(null);
    try {
      const res = await fetch("/api/ai/meeting-notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentName, transcript: transcriptText(lines) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.markdown !== "string") {
        setError(json?.error ?? "Couldn't write notes. You can still add the transcript.");
        setPhase("review");
        return;
      }
      if (!insert(json.markdown)) setPhase("review");
    } catch {
      setError("Couldn't write notes. You can still add the transcript.");
      setPhase("review");
    }
  }

  const hasTranscript = lines.length > 0;
  const duration = Math.max(recordedSeconds, hasTranscript ? Math.max(...lines.map((l) => l.at)) : 0);
  const status =
    phase === "idle"
      ? "Records this Mac's audio and mic in the DALI OS app."
      : phase === "starting"
        ? "Opening the DALI OS app…"
        : phase === "unreachable"
          ? "The DALI OS app didn't respond."
          : phase === "recording"
            ? null
            : phase === "stopping"
              ? "Stopping…"
              : `${formatClock(duration)} recorded`;

  const statusLine = status ?? (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      {formatClock(recordedSeconds + (now - startedAt) / 1000)}
      {!systemAudio && " · Mic only"}
    </span>
  );

  return (
    <>
      <Tooltip content={phase === "idle" ? "Record this meeting" : "Show recording"}>
        <button
          type="button"
          onClick={phase === "idle" && !error ? start : () => setOpen(true)}
          aria-label={phase === "idle" ? "Record this meeting" : "Show recording"}
          className={cn(
            actionBtnPrimary,
            (phase === "recording" || phase === "stopping") &&
              "border-accent-coral bg-accent-coral text-navy-deep hover:border-accent-coral-light hover:bg-accent-coral-light",
          )}
        >
          <Mic className={actionIcon} />
          {phase === "idle" || phase === "unreachable" ? (
            <span className="hidden sm:inline">Record</span>
          ) : phase === "starting" ? (
            "Opening app…"
          ) : phase === "recording" ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              Recording {formatClock(recordedSeconds + (now - startedAt) / 1000)}
            </>
          ) : phase === "stopping" ? (
            "Stopping…"
          ) : (
            formatClock(duration)
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
          title={phase === "recording" ? "Recording" : "Record this meeting"}
          subtitle={statusLine}
          onClose={() => setOpen(false)}
          className="mb-4"
        />
        {(phase === "recording" || phase === "stopping" || phase === "review" || phase === "writing") && (
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed"
          >
            {!hasTranscript ? (
              <p className="text-muted-foreground">
                {phase === "review" || phase === "writing" ? "Nothing was transcribed." : "Listening…"}
              </p>
            ) : (
              [...lines]
                .sort((a, b) => a.at - b.at)
                .map((l, i) => (
                  <p key={i} className="text-foreground">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                      {formatClock(l.at)}
                    </span>
                    {l.source && (
                      <span className="mr-1 font-medium text-muted-foreground">
                        {SOURCE_LABEL[l.source]}:
                      </span>
                    )}
                    {l.text}
                  </p>
                ))
            )}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-1.5">
          {phase === "idle" && (
            <button type="button" onClick={start} className={buttonClasses("primary", "sm")}>
              <Mic className="h-3.5 w-3.5" /> Record
            </button>
          )}
          {phase === "unreachable" && (
            <>
              <IconButton label="Cancel" icon={Trash2} tone="destructive" onClick={cancelStart} />
              <a href="/download" className={buttonClasses("secondary", "sm")}>
                Get the app
              </a>
              <button
                type="button"
                onClick={hasTranscript ? resume : start}
                className={buttonClasses("primary", "sm")}
              >
                Try again
              </button>
            </>
          )}
          {(phase === "starting" || phase === "recording" || phase === "stopping") && (
            <button
              type="button"
              onClick={phase === "starting" ? cancelStart : stop}
              disabled={phase === "stopping"}
              className={buttonClasses("secondary", "sm")}
            >
              {phase === "starting" ? (
                "Cancel"
              ) : (
                <>
                  <Square className="h-3 w-3 fill-current" /> Stop
                </>
              )}
            </button>
          )}
          {(phase === "review" || phase === "writing") && (
            <>
              <IconButton
                label="Discard recording"
                icon={Trash2}
                tone="destructive"
                onClick={() => void discard()}
                disabled={phase === "writing"}
              />
              <button
                type="button"
                onClick={resume}
                disabled={phase === "writing"}
                className={buttonClasses("secondary", "sm")}
              >
                <Mic className="h-3.5 w-3.5" /> Continue
              </button>
              {aiEnabled && error && hasTranscript && (
                <button
                  type="button"
                  onClick={() => insert(null)}
                  disabled={phase === "writing"}
                  className={buttonClasses("secondary", "sm")}
                >
                  Add transcript only
                </button>
              )}
              <button
                type="button"
                onClick={aiEnabled ? writeNotes : () => insert(null)}
                disabled={!hasTranscript || phase === "writing"}
                className={buttonClasses("primary", "sm")}
              >
                {!aiEnabled ? "Add transcript" : phase === "writing" ? "Writing notes…" : "Write notes"}
              </button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
