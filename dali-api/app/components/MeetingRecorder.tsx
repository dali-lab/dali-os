import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  SOURCE_LABEL,
  formatClock,
  meetingNotesMarkdown,
  transcriptText,
  type TranscriptLine,
} from "~/lib/meeting-transcript";

type Phase = "idle" | "starting" | "unreachable" | "recording" | "stopping" | "review" | "writing";

type PollResponse = {
  status: "Pending" | "Recording" | "Stopped" | "Failed";
  systemAudio: boolean;
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

// Shown on a meeting-note document. Recording always happens in the DALI OS
// desktop app, whichever window started it: the page creates a recording and
// opens its dalios:// link, the app captures the Mac's system audio (everyone
// on a call) plus the mic and transcribes on-device, and the page polls the
// lines through the server. On stop, /api/ai/meeting-notes turns them into
// notes appended to the doc through the live editor.
export function MeetingRecorder({
  pageId,
  onInsert,
  aiEnabled,
}: {
  pageId: string;
  /** Appends Markdown to the note. False when the editor isn't ready yet. */
  onInsert: (markdown: string) => boolean;
  /** Without an AI provider, the recording still lands as a transcript. */
  aiEnabled: boolean;
}) {
  const { panel } = useOsChrome();
  const [phase, setPhase] = useState<Phase>("idle");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [systemAudio, setSystemAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stopAskedAt = useRef(0);

  const live = phase === "starting" || phase === "recording" || phase === "stopping";

  // Poll the transcript while the app is (or should be) recording.
  useEffect(() => {
    if (!recordingId || !live) return;
    let cancelled = false;
    let since = 0;
    const created = Date.now();
    async function tick() {
      try {
        const res = await fetch(`/api/meeting-recordings/${recordingId}?since=${since}`, {
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
        if (data.lines.length) setLines((prev) => [...prev, ...data.lines]);
        since = data.total;
        setSystemAudio(data.systemAudio);
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
    // Re-arming on each live phase change would reset `since`; the id is enough.
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
  }, [lines]);

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
    if (recordingId) reset();
    setError(null);
    try {
      const res = await fetch("/api/meeting-recordings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.id !== "string") {
        setError(json?.error ?? "Couldn't start recording.");
        return;
      }
      setRecordingId(json.id);
      setStartedAt(Date.now());
      setPhase("starting");
      openInApp(json.link);
    } catch {
      setError("Couldn't start recording.");
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

  function reset() {
    if (recordingId) {
      void fetch(`/api/meeting-recordings/${recordingId}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => null);
    }
    setRecordingId(null);
    stopAskedAt.current = 0;
    setLines([]);
    setError(null);
    setPhase("idle");
  }

  function insert(notes: string | null) {
    if (!onInsert(meetingNotesMarkdown(notes, lines))) {
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
        body: JSON.stringify({ pageId, transcript: transcriptText(lines) }),
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
  const duration = hasTranscript ? Math.max(...lines.map((l) => l.at)) : 0;
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

  return (
    <section className={cn(panel, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              phase === "recording" ? "bg-red-500/10 text-red-600" : "bg-os-container text-os-accent",
            )}
          >
            <Mic className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-sm font-semibold text-foreground">
              {phase === "recording" ? "Recording" : "Record this meeting"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {status ?? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  {formatClock((now - startedAt) / 1000)}
                  {!systemAudio && " · Mic only"}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {phase === "idle" && (
            <button type="button" onClick={start} className={buttonClasses("primary", "sm")}>
              <Mic className="h-3.5 w-3.5" /> Record
            </button>
          )}
          {phase === "unreachable" && (
            <>
              <IconButton label="Cancel" icon={Trash2} tone="destructive" onClick={reset} />
              <a href="/download" className={buttonClasses("secondary", "sm")}>
                Get the app
              </a>
              <button type="button" onClick={start} className={buttonClasses("primary", "sm")}>
                Try again
              </button>
            </>
          )}
          {(phase === "starting" || phase === "recording" || phase === "stopping") && (
            <button
              type="button"
              onClick={phase === "starting" ? reset : stop}
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
                onClick={reset}
                disabled={phase === "writing"}
              />
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
      </div>

      {(phase === "recording" || phase === "stopping" || phase === "review" || phase === "writing") && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed"
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

      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
