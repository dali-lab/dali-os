// Hover card for a citation chip (specs/meeting-notes-model.md §3). Chips are
// ordinary BlockNote links — there's no custom inline node to attach a React
// hover card to directly, so this delegates mouseover on the editor's
// container to any <a> whose href carries `?transcript=`, lazily fetches that
// recording once (cached per recording, same pattern as MentionHoverCard),
// and shows who said the cited line, when, and the quote near the chip.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DUR, enterRef } from "./motion";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { countSpeakersByChannel, formatClock, nearestLine, speakerLabelFor } from "./transcript";
import type { Speakers, SpeakerKey, TranscriptLine } from "./types";

type LoadedRecording = {
  lines: TranscriptLine[];
  speakers: Speakers;
  speakerNames: Record<SpeakerKey, string>;
};
type CachedLines = LoadedRecording | null;

const cache = new Map<string, CachedLines>();
const inflight = new Map<string, Promise<CachedLines>>();

export function clearChipRecordingCache(): void {
  cache.clear();
  inflight.clear();
}

async function loadLines(recordingId: string): Promise<CachedLines> {
  if (cache.has(recordingId)) return cache.get(recordingId)!;
  const existing = inflight.get(recordingId);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`/api/meeting-recordings/${encodeURIComponent(recordingId)}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<LoadedRecording>;
      return {
        lines: Array.isArray(data.lines) ? data.lines : [],
        speakers: data.speakers ?? {},
        speakerNames: data.speakerNames ?? {},
      };
    } catch {
      return null;
    } finally {
      inflight.delete(recordingId);
    }
  })();
  inflight.set(recordingId, p);
  const lines = await p;
  cache.set(recordingId, lines);
  return lines;
}

function parseChipHref(href: string): { recordingId: string; at: number } | null {
  try {
    const url = new URL(href, window.location.origin);
    const recordingId = url.searchParams.get("transcript");
    const at = Number(url.searchParams.get("at"));
    if (!recordingId || !Number.isFinite(at)) return null;
    return { recordingId, at };
  } catch {
    return null;
  }
}

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 120;
const CARD_IN = enterRef(
  [
    { opacity: 0, transform: "translateY(-4px) scale(.97)" },
    { opacity: 1, transform: "none" },
  ],
  DUR.card,
);

const CARD_WIDTH = 290;

function chipAnchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
  return (target as HTMLElement | null)?.closest?.('a[href*="?transcript="]') as HTMLAnchorElement | null;
}

type ChipCard = {
  top: number;
  left: number;
  recordingId: string;
  at: number;
  href: string;
  state: "loading" | "ready" | "unavailable";
  name: string;
  clock: string;
  quote: string;
};

export function TranscriptChipHoverLayer({
  children,
  onChipClick,
  railOpen = false,
}: {
  children: React.ReactNode;
  /** A plain click (or Enter on a focused chip): opens the rail and scrolls
   *  to `at` when it returns true (specs/meeting-recording-rail.md "Citation
   *  chips") — the chip's default navigation is prevented. Returning false
   *  (e.g. the chip cites a different recording than the one loaded) lets
   *  the `?transcript=&at=` href navigate normally. */
  onChipClick?: (recordingId: string, at: number) => boolean;
  /** Whether the rail this layer can open is currently open — used only to
   *  return focus to the chip once it closes again. */
  railOpen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [card, setCard] = useState<ChipCard | null>(null);
  const returnFocusRef = useRef<HTMLAnchorElement | null>(null);
  const wasOpenRef = useRef(railOpen);
  // A ref, not an effect dependency: onChipClick is a fresh closure on every
  // render (the route builds it inline), and re-attaching listeners on every
  // render just to read the latest one isn't worth it.
  const onChipClickRef = useRef(onChipClick);
  onChipClickRef.current = onChipClick;

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function scheduleClose() {
    clearTimer();
    timer.current = setTimeout(() => {
      anchorRef.current = null;
      setCard(null);
    }, CLOSE_DELAY_MS);
  }

  function openInTranscript(c: ChipCard) {
    if (!onChipClickRef.current?.(c.recordingId, c.at)) window.location.assign(c.href);
    clearTimer();
    anchorRef.current = null;
    setCard(null);
  }

  useEffect(() => {
    if (wasOpenRef.current && !railOpen && returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
    wasOpenRef.current = railOpen;
  }, [railOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Plain clicks open the rail and scroll to the cited line; a modifier or
    // middle click falls through to the browser (open in new tab, etc.).
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = chipAnchorFrom(e.target);
      if (!target || !onChipClickRef.current) return;
      const parsed = parseChipHref(target.getAttribute("href") ?? "");
      if (!parsed) return;
      if (onChipClickRef.current(parsed.recordingId, parsed.at)) {
        e.preventDefault();
        returnFocusRef.current = target;
      }
    }

    // Enter on a focused chip does the same.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const target = chipAnchorFrom(document.activeElement);
      if (!target || !onChipClickRef.current) return;
      const parsed = parseChipHref(target.getAttribute("href") ?? "");
      if (!parsed) return;
      if (onChipClickRef.current(parsed.recordingId, parsed.at)) {
        e.preventDefault();
        returnFocusRef.current = target;
      }
    }
    container.addEventListener("click", onClick);
    container.addEventListener("keydown", onKeyDown);

    function onOver(e: MouseEvent) {
      const target = chipAnchorFrom(e.target);
      if (!target) return;
      if (target === anchorRef.current) {
        clearTimer();
        return;
      }
      const parsed = parseChipHref(target.getAttribute("href") ?? "");
      if (!parsed) return;
      anchorRef.current = target;
      clearTimer();
      timer.current = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const base = {
          top: rect.bottom + 6,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 16)),
          recordingId: parsed.recordingId,
          at: parsed.at,
          href: target.getAttribute("href") ?? "",
          name: "",
          clock: formatClock(parsed.at),
          quote: "",
        };
        setCard({ ...base, state: "loading" });
        void loadLines(parsed.recordingId).then((loaded) => {
          if (anchorRef.current !== target) return;
          const line = loaded ? nearestLine(loaded.lines, parsed.at) : null;
          if (!loaded || !line) {
            setCard({ ...base, state: "unavailable" });
            return;
          }
          setCard({
            ...base,
            state: "ready",
            name: speakerLabelFor(line, countSpeakersByChannel(loaded.lines), loaded.speakers, [], loaded.speakerNames),
            clock: formatClock(line.at),
            quote: line.text,
          });
        });
      }, OPEN_DELAY_MS);
    }

    function onOut(e: MouseEvent) {
      const related = e.relatedTarget as Node | null;
      if (anchorRef.current && related && anchorRef.current.contains(related)) return;
      scheduleClose();
    }

    container.addEventListener("mouseover", onOver);
    container.addEventListener("mouseout", onOut);
    return () => {
      container.removeEventListener("click", onClick);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("mouseout", onOut);
      clearTimer();
    };
  }, []);

  return (
    <div ref={containerRef} className="contents">
      {children}
      {card &&
        createPortal(
          <div
            ref={CARD_IN}
            role="group"
            aria-label="Transcript quote"
            onMouseEnter={clearTimer}
            onMouseLeave={scheduleClose}
            style={{ position: "fixed", top: card.top, left: card.left, width: CARD_WIDTH, zIndex: 60 }}
            className={cn("p-3 text-[13.5px] leading-5 text-foreground", OS_SURFACE_CLASS)}
          >
            {card.state === "loading" && <p className="text-muted-foreground">Loading…</p>}
            {card.state === "unavailable" && <p>Transcript unavailable.</p>}
            {card.state === "ready" && (
              <>
                <div className="mb-1.5 flex items-center gap-2 font-bold">
                  <Avatar name={card.name} size="xs" />
                  {card.name}
                  <span className="font-medium text-muted-foreground">{card.clock}</span>
                </div>
                <p>“{card.quote}”</p>
              </>
            )}
            <button
              type="button"
              onClick={() => openInTranscript(card)}
              className="mt-2 block text-xs font-bold text-os-accent hover:underline"
            >
              Open in transcript
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
