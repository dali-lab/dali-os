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

export function TranscriptChipHoverLayer({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [card, setCard] = useState<{ top: number; left: number; text: string | null } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function clearTimer() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }

    function onOver(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest?.('a[href*="?transcript="]') as
        | HTMLAnchorElement
        | null;
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
