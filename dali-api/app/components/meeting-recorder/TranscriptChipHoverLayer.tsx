// Hover card for a citation chip (specs/meeting-notes-model.md §3). Chips are
// ordinary BlockNote links — there's no custom inline node to attach a React
// hover card to directly, so this delegates mouseover on the editor's
// container to any <a> whose href carries `?transcript=`, lazily fetches that
// recording's lines once (cached per recording, same pattern as
// MentionHoverCard), and shows the cited line near the chip.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import type { TranscriptLine } from "./types";

type CachedLines = TranscriptLine[] | null;

const cache = new Map<string, CachedLines>();
const inflight = new Map<string, Promise<CachedLines>>();

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
      const data = (await res.json()) as { lines?: TranscriptLine[] };
      return Array.isArray(data.lines) ? data.lines : [];
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

function closestLine(lines: TranscriptLine[], at: number): TranscriptLine | null {
  let best: TranscriptLine | null = null;
  for (const line of lines) {
    if (!best || Math.abs(line.at - at) < Math.abs(best.at - at)) best = line;
  }
  return best;
}

const OPEN_DELAY_MS = 250;

function chipAnchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
  return (target as HTMLElement | null)?.closest?.('a[href*="?transcript="]') as HTMLAnchorElement | null;
}

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
  const [card, setCard] = useState<{ top: number; left: number; text: string | null } | null>(null);
  const returnFocusRef = useRef<HTMLAnchorElement | null>(null);
  const wasOpenRef = useRef(railOpen);
  // A ref, not an effect dependency: onChipClick is a fresh closure on every
  // render (the route builds it inline), and re-attaching listeners on every
  // render just to read the latest one isn't worth it.
  const onChipClickRef = useRef(onChipClick);
  onChipClickRef.current = onChipClick;

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

    function clearTimer() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }

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
      if (!target || target === anchorRef.current) return;
      const parsed = parseChipHref(target.getAttribute("href") ?? "");
      if (!parsed) return;
      anchorRef.current = target;
      clearTimer();
      timer.current = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        setCard({ top: rect.bottom + 6, left: rect.left, text: null });
        void loadLines(parsed.recordingId).then((lines) => {
          if (anchorRef.current !== target) return;
          const line = lines ? closestLine(lines, parsed.at) : null;
          setCard((c) => (c ? { ...c, text: line?.text ?? "Transcript unavailable." } : c));
        });
      }, OPEN_DELAY_MS);
    }

    function onOut(e: MouseEvent) {
      const related = e.relatedTarget as Node | null;
      if (anchorRef.current && related && anchorRef.current.contains(related)) return;
      clearTimer();
      anchorRef.current = null;
      setCard(null);
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
            role="tooltip"
            style={{ position: "fixed", top: card.top, left: card.left, zIndex: 60 }}
            className={cn("max-w-[320px] p-2.5 text-sm text-foreground", OS_SURFACE_CLASS)}
          >
            {card.text ?? "Loading…"}
          </div>,
          document.body,
        )}
    </div>
  );
}
