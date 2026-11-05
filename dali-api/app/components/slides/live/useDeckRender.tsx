import { useCallback, useMemo } from "react";
import { buildSteps } from "~/components/slides/deck/builds";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import type { PresentDeck } from "./deck-source";
import type { RenderSlide } from "./types";

/** What the stage and presenter view need from a deck: ids, steps per slide and a slide drawer. */
export function useDeckRender(deck: PresentDeck) {
  const slideIds = useMemo(() => deck.slides.map((s) => s.id), [deck.slides]);
  const stepsOf = useCallback((index: number) => (deck.slides[index] ? buildSteps(deck.slides[index]) : 0), [deck.slides]);
  const renderSlide = useCallback<RenderSlide>(
    (id, { step }) => {
      const slide = deck.slides.find((s) => s.id === id);
      return slide ? <SlideRender slide={slide} theme={deck.themeId} step={step} /> : null;
    },
    [deck.slides, deck.themeId],
  );
  return { slideIds, stepsOf, renderSlide };
}

export function positionFor(slideIds: string[], stepsOf: (i: number) => number, slideId: string | null, step: number) {
  const index = slideId ? slideIds.indexOf(slideId) : -1;
  if (index < 0) return null;
  return { index, step: Math.min(Math.max(step, 0), stepsOf(index)) };
}
