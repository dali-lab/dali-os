import { useCallback, useMemo } from "react";
import { autoDelayAt, buildSteps } from "~/components/slides/deck/builds";
import { HtmlFrame, PlayableVideo } from "~/components/slides/deck/content-render";
import { presentable } from "~/components/slides/deck/skip";
import { SlideRender, type FreeContext } from "~/components/slides/deck/SlideRender";
import { themeById } from "~/components/slides/deck/themes";
import type { PresentDeck } from "./deck-source";
import type { RenderSlide } from "./types";

const playFree = (themeId: string, live: boolean) => {
  const theme = themeById(themeId);
  return ({ element, placed, fallback }: FreeContext) => {
    if (element.kind === "video") return <PlayableVideo element={element} placed={placed} />;
    if (element.kind === "html" && live) return <HtmlFrame element={element} placed={placed} theme={theme} />;
    return fallback;
  };
};

/** What the stage and presenter view need from a deck: ids, steps per slide and a slide drawer. */
export function useDeckRender(deck: PresentDeck) {
  const slides = useMemo(() => presentable(deck.slides), [deck.slides]);
  const slideIds = useMemo(() => slides.map((s) => s.id), [slides]);
  const stepsOf = useCallback((index: number) => (slides[index] ? buildSteps(slides[index]) : 0), [slides]);
  const autoDelayOf = useCallback((index: number, step: number) => (slides[index] ? autoDelayAt(slides[index], step) : null), [slides]);
  const isAuto = useCallback((index: number, step: number) => autoDelayOf(index, step) !== null, [autoDelayOf]);
  const renderSlide = useCallback<RenderSlide>(
    (id, { step, enterStep, thumb }) => {
      const slide = deck.slides.find((s) => s.id === id);
      return slide ? <SlideRender slide={slide} theme={deck.themeId} step={step} enterStep={enterStep} renderFree={playFree(deck.themeId, !thumb)} /> : null;
    },
    [deck.slides, deck.themeId],
  );
  return { slideIds, stepsOf, autoDelayOf, isAuto, renderSlide };
}

export function positionFor(slideIds: string[], stepsOf: (i: number) => number, slideId: string | null, step: number) {
  const index = slideId ? slideIds.indexOf(slideId) : -1;
  if (index < 0) return null;
  return { index, step: Math.min(Math.max(step, 0), stepsOf(index)) };
}
