import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { navActionFor, nextIndex } from "./keys";
import type { RenderSlide } from "./types";

export interface PresenterViewProps {
  title: string;
  slideIds: string[];
  notes: Record<string, string>;
  index: number;
  onIndexChange: (index: number) => void;
  renderSlide: RenderSlide;
  onEnd: () => void;
  shareUrl?: string;
  followerCount?: number;
  startedAt?: string | null;
}

const NOW_WIDTH = 560;
const NEXT_WIDTH = 280;
const THUMB_WIDTH = 112;
const NOTES_MIN = 12;
const NOTES_MAX = 32;

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function PresenterView({
  title,
  slideIds,
  notes,
  index,
  onIndexChange,
  renderSlide,
  onEnd,
  shareUrl,
  followerCount,
  startedAt,
}: PresenterViewProps) {
  const total = slideIds.length;
  const [now, setNow] = useState(() => Date.now());
  const [base, setBase] = useState(() => (startedAt ? Date.parse(startedAt) : Date.now()));
  const [noteSize, setNoteSize] = useState(16);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = navActionFor(e.key);
      if (!action || action === "exit") return;
      e.preventDefault();
      const next = nextIndex(action, index, total);
      if (next !== index) onIndexChange(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, onIndexChange]);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const slideId = slideIds[index];
  const nextId = slideIds[index + 1];
  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-os-bg text-os-fg" data-testid="presenter-view">
      <header className="flex items-center gap-4 border-b border-os-container bg-os-nav px-4 py-2 text-sm">
        <span className="truncate font-semibold">{title}</span>
        <span className="text-os-grey">
          Slide {index + 1} of {total}
        </span>
        <span className="flex items-center gap-1 text-os-grey">
          Elapsed <span className="tabular-nums text-os-fg">{formatElapsed(now - base)}</span>
          <Button variant="ghost" size="xs" onClick={() => setBase(Date.now())}>
            Reset
          </Button>
        </span>
        <span className="ml-auto text-os-grey">{clock}</span>
        {followerCount != null && <span className="text-os-grey">{followerCount} following</span>}
        {shareUrl && (
          <Button variant="secondary" size="xs" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button variant="destructive" size="xs" onClick={onEnd}>
          End
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-os-grey">Now</div>
          <div className="overflow-hidden rounded-os-item border border-os-container" style={{ width: NOW_WIDTH, aspectRatio: "16 / 9" }}>
            {slideId ? renderSlide(slideId, { width: NOW_WIDTH }) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button variant="primary" size="sm" disabled={index >= total - 1} onClick={() => onIndexChange(index + 1)}>
              Next slide
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="filmstrip">
            {slideIds.map((id, i) => (
              <button
                key={id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => onIndexChange(i)}
                className={cn(
                  "shrink-0 overflow-hidden rounded-os-item border-2",
                  i === index ? "border-os-accent" : "border-os-container hover:border-os-container-hi",
                )}
                style={{ width: THUMB_WIDTH, aspectRatio: "16 / 9" }}
              >
                {renderSlide(id, { width: THUMB_WIDTH })}
              </button>
            ))}
          </div>
        </section>

        <aside className="flex w-80 shrink-0 flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-os-grey">Next slide</div>
          <div
            className="flex items-center justify-center overflow-hidden rounded-os-item border border-os-container bg-os-card text-xs text-os-grey"
            style={{ width: NEXT_WIDTH, aspectRatio: "16 / 9" }}
          >
            {nextId ? renderSlide(nextId, { width: NEXT_WIDTH }) : "End of deck"}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-os-grey">Notes</span>
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="xs" aria-label="Smaller notes" disabled={noteSize <= NOTES_MIN} onClick={() => setNoteSize((s) => s - 2)}>
                A−
              </Button>
              <Button variant="ghost" size="xs" aria-label="Larger notes" disabled={noteSize >= NOTES_MAX} onClick={() => setNoteSize((s) => s + 2)}>
                A+
              </Button>
            </span>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-os-item bg-os-card p-3 text-os-grey"
            style={{ fontSize: noteSize }}
            data-testid="notes"
          >
            {(slideId && notes[slideId]) || "No notes for this slide."}
          </div>
        </aside>
      </div>
    </div>
  );
}
