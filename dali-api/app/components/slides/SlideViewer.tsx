import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import type { Slide } from "~/components/slides/types";
import { SlideCanvas } from "./SlideCanvas";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function SlideViewer({
  slides,
  index,
  onIndexChange,
  finalAction,
}: {
  slides: Slide[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Shown in place of "Next" on the last slide. */
  finalAction: { label: string; onClick: () => void };
}) {
  const [presenting, setPresenting] = useState(false);
  const total = slides.length;
  const slide = slides[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const go = useCallback(
    (delta: number) => onIndexChange(Math.min(total - 1, Math.max(0, index + delta))),
    [index, total, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (presenting && e.key === " ")) {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape" && presenting) {
        // Claim it so a surrounding FullscreenEditor doesn't close too.
        e.preventDefault();
        setPresenting(false);
      }
    };
    // Capture so the present overlay's Escape runs before bubbling listeners.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, presenting]);

  if (!slide) return <p className="p-10 text-os-grey">This module doesn't have any slides yet.</p>;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="w-full max-w-5xl px-6 py-8 lg:px-10">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm tabular-nums text-os-muted">
            Slides · {index + 1} of {total}
          </p>
          <button type="button" onClick={() => setPresenting(true)} className={buttonClasses("ghost", "sm")}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            Present
          </button>
        </div>

        <div className="mt-3 overflow-hidden rounded-os-item ring-1 ring-os-container" aria-live="polite" aria-label={`Slide ${index + 1}`}>
          <SlideCanvas slide={slide} number={index + 1} />
        </div>

        <div className="mt-5 flex items-center gap-4">
          <button type="button" onClick={() => go(-1)} disabled={isFirst} className={buttonClasses("ghost", "md", "shrink-0")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Previous
          </button>
          <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label="Jump to slide">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={`Slide ${i + 1}${s.title ? `: ${s.title}` : ""}`}
                aria-current={i === index ? "step" : undefined}
                className="group flex h-6 min-w-0 flex-1 items-center"
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors",
                    i <= index ? "bg-os-accent" : "bg-os-container group-hover:bg-os-container-hi",
                  )}
                />
              </button>
            ))}
          </div>
          {isLast ? (
            <button type="button" onClick={finalAction.onClick} className={buttonClasses("primary", "md", "shrink-0")}>
              {finalAction.label}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button type="button" onClick={() => go(1)} className={buttonClasses("secondary", "md", "shrink-0")}>
              Next
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-os-muted">Use the ← and → keys to move between slides.</p>

        {slide.notes?.trim() && (
          <section className="mt-10 max-w-3xl border-t border-os-container pt-6" aria-labelledby="slide-notes">
            <h3 id="slide-notes" className="text-xs font-medium text-os-grey">
              Notes
            </h3>
            <p className="mt-2 whitespace-pre-line leading-7 text-foreground/85">{slide.notes}</p>
          </section>
        )}
      </div>

      {presenting &&
        typeof document !== "undefined" &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label="Presenting slides" className="fixed inset-0 z-[46] flex flex-col bg-black">
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <div className="w-full" style={{ maxWidth: "calc((100vh - 88px) * 16 / 9)" }}>
                <SlideCanvas slide={slide} number={index + 1} />
              </div>
            </div>
            <div className="flex h-14 shrink-0 items-center justify-between px-4 text-sm text-white/60">
              <button
                type="button"
                onClick={() => setPresenting(false)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
                Exit
                <span className="text-white/40">Esc</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={isFirst}
                  aria-label="Previous slide"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="w-16 text-center tabular-nums">
                  {index + 1} / {total}
                </span>
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={isLast}
                  aria-label="Next slide"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <span className="w-24" aria-hidden />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
