import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  formatClock,
  meetingNotesMarkdown,
  transcriptText,
  type TranscriptLine,
} from "~/lib/meeting-transcript";

// Minimal Web Speech API surface. Not in TypeScript's DOM lib, and only
// Chromium and WebKit ship it (prefixed in both).
type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Phase = "idle" | "recording" | "review" | "writing";

// Shown on a meeting-note document. Records the microphone through the
// browser's own speech recognition, so nothing but the finished transcript
// leaves the page. On stop, /api/ai/meeting-notes turns it into notes and both
// are appended to the doc through the live editor (so collaborators see it
// land like any other edit).
export function MeetingRecorder({
  pageId,
  onInsert,
}: {
  pageId: string;
  /** Appends Markdown to the note. False when the editor isn't ready yet. */
  onInsert: (markdown: string) => boolean;
}) {
  const { panel } = useOsChrome();
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<Recognition | null>(null);
  // Chrome ends a session after a stretch of silence; while this is true the
  // onend handler starts a new one so a long meeting keeps recording.
  const wantRecordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 1000);
    // Leaving the page would silently drop the transcript.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", warn);
    };
  }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, interim]);

  useEffect(
    () => () => {
      wantRecordingRef.current = false;
      recognitionRef.current?.abort();
    },
    [],
  );

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    setLines([]);
    setInterim("");
    setElapsed(0);
    startedAtRef.current = Date.now();
    wantRecordingRef.current = true;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const at = (Date.now() - startedAtRef.current) / 1000;
          if (text.trim()) setLines((prev) => [...prev, { at, text: text.trim() }]);
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are routine; onend restarts or finishes.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantRecordingRef.current = false;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access is blocked. Allow it in your browser settings."
          : "Recording stopped unexpectedly.",
      );
    };
    rec.onend = () => {
      if (wantRecordingRef.current) {
        try {
          rec.start();
          return;
        } catch {
          wantRecordingRef.current = false;
        }
      }
      setInterim("");
      setPhase((p) => (p === "recording" ? "review" : p));
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setPhase("recording");
    } catch {
      wantRecordingRef.current = false;
      setError("Couldn't start recording.");
    }
  }

  function stop() {
    wantRecordingRef.current = false;
    recognitionRef.current?.stop();
  }

  function discard() {
    setLines([]);
    setElapsed(0);
    setError(null);
    setPhase("idle");
  }

  function insert(notes: string | null) {
    if (!onInsert(meetingNotesMarkdown(notes, lines))) {
      setError("The note is still loading. Try again in a moment.");
      return false;
    }
    discard();
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

  if (!supported) {
    return (
      <section className={cn(panel, "flex items-center gap-3 p-4 text-sm text-muted-foreground")}>
        <Mic className="h-4 w-4 shrink-0" />
        Recording needs Chrome, Edge, or Safari.
      </section>
    );
  }

  const hasTranscript = lines.length > 0;

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
              {phase === "recording" ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  {formatClock(elapsed)}
                </span>
              ) : phase === "idle" ? (
                "Transcribes what this device hears. AI writes the notes."
              ) : (
                `${formatClock(elapsed)} recorded`
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
          {phase === "recording" && (
            <button type="button" onClick={stop} className={buttonClasses("secondary", "sm")}>
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
          {(phase === "review" || phase === "writing") && (
            <>
              <IconButton
                label="Discard recording"
                icon={Trash2}
                tone="destructive"
                onClick={discard}
                disabled={phase === "writing"}
              />
              {error && hasTranscript && (
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
                onClick={writeNotes}
                disabled={!hasTranscript || phase === "writing"}
                className={buttonClasses("primary", "sm")}
              >
                {phase === "writing" ? "Writing notes…" : "Write notes"}
              </button>
            </>
          )}
        </div>
      </div>

      {(phase === "recording" || phase === "review" || phase === "writing") && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed"
        >
          {!hasTranscript && !interim ? (
            <p className="text-muted-foreground">
              {phase === "recording" ? "Listening…" : "Nothing was transcribed."}
            </p>
          ) : (
            <>
              {lines.map((l, i) => (
                <p key={i} className="text-foreground">
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                    {formatClock(l.at)}
                  </span>
                  {l.text}
                </p>
              ))}
              {interim && <p className="italic text-muted-foreground">{interim}</p>}
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
