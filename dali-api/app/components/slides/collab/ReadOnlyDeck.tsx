import { useState } from "react";
import { ScaledSlide } from "~/components/slides/deck/SlideRender";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { cn } from "~/lib/cn";
import { FitBox } from "./SlideStage";
import { SlideRender } from "~/components/slides/deck/SlideRender";

/** A deck drawn from loader data: the view for people who can't edit, and for decks this build doesn't know how to edit. */
export function ReadOnlyDeck({ slides, themeId, notice }: { slides: RenderSlide[]; themeId: string; notice?: string }) {
  const [index, setIndex] = useState(0);
  const current = slides[Math.min(index, slides.length - 1)];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice && (
        <p role="status" className="shrink-0 border-b border-os-container px-4 py-2 text-sm text-os-grey">
          {notice}
        </p>
      )}
      {!current ? (
        <p className="p-6 text-os-grey">This deck doesn't have any slides yet.</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Slides" className="w-44 shrink-0 overflow-y-auto border-r border-os-container p-2">
            <ol className="flex flex-col gap-2">
              {slides.map((slide, i) => (
                <li key={slide.id} className="flex items-start gap-1.5">
                  <span className="w-4 pt-1 text-right text-xs tabular-nums text-os-muted">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={slide.id === current.id ? "true" : undefined}
                    aria-label={`Slide ${i + 1}`}
                    className={cn(
                      "block min-w-0 flex-1 overflow-hidden rounded-lg ring-2 transition-shadow",
                      slide.id === current.id ? "ring-os-accent" : "ring-transparent hover:ring-os-container",
                    )}
                  >
                    <ScaledSlide slide={slide} theme={themeId} className="pointer-events-none" />
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <FitBox>
              {() => (
                <SlideRender className="rounded-os-card shadow-sm" slide={current} theme={themeId} />
              )}
            </FitBox>
          </div>
        </div>
      )}
    </div>
  );
}
