import { useCallback, useMemo } from "react";
import { buildSteps } from "~/components/slides/deck/builds";
import { PlayableVideo } from "~/components/slides/deck/content-render";
import { presentable } from "~/components/slides/deck/skip";
import { SlideRender, type FreeContext } from "~/components/slides/deck/SlideRender";
import type { PresentDeck } from "./deck-source";
import type { RenderSlide } from "./types";

const playVideo = ({ element, placed, fallback }: FreeContext) => (element.kind === "video" ? <PlayableVideo element={element} placed={placed} /> : fallback);

/** What the stage and presenter view need from a deck: ids, steps per slide and a slide drawer. */
export function useDeckRender(deck: PresentDeck) {
  const slides = useMemo(() => presentable(deck.slides), [deck.slides]);
  const slideIds = useMemo(() => slides.map((s) => s.id), [slides]);
  const stepsOf = useCallback((index: number) => (slides[index] ? buildSteps(slides[index]) : 0), [slides]);
  const renderSlide = useCallback<RenderSlide>(
    (id, { step }) => {
      const slide = deck.slides.find((s) => s.id === id);
      return slide ? <SlideRender slide={slide} theme={deck.themeId} step={step} renderFree={playVideo} /> : null;
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
