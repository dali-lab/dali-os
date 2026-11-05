import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useDesktopVersion } from "~/lib/desktop";
import { Button } from "~/components/ui/Button";
import { movePosition, samePosition, type DeckPosition } from "~/components/slides/deck/builds";
import { navActionFor, nextIndex } from "./keys";
import type { RenderSlide } from "./types";
import type { RenderSlide as DeckSlide } from "~/components/slides/deck/snapshot";
import { SlideTransitionStage } from "./SlideTransitionStage";
import { useEnterStep } from "./useBuildMotion";

export interface PresentStageProps {
  slideIds: string[];
  index: number;
  onIndexChange: (index: number) => void;
  /** With `onPositionChange`, navigation moves through build steps as well as slides. */
  step?: number;
  stepsOf?: (index: number) => number;
  isAuto?: (index: number, step: number) => boolean;
  onPositionChange?: (pos: DeckPosition) => void;
  renderSlide: RenderSlide;
  transitions?: { slides: DeckSlide[]; themeId: string };
  onExit?: () => void;
  navigable?: boolean;
  children?: React.ReactNode;
}

const ASPECT = 16 / 9;

export function PresentStage({ slideIds, index, onIndexChange, step, stepsOf, isAuto, onPositionChange, renderSlide, transitions, onExit, navigable = true, children }: PresentStageProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const desktop = useDesktopVersion() != null;
  const total = slideIds.length;
  const slideId = slideIds[index];
  const enterStep = useEnterStep(index, step ?? 0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(Math.min(el.clientWidth, el.clientHeight * ASPECT)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const go = useCallback(
    (action: NonNullable<ReturnType<typeof navActionFor>>) => {
      if (action === "exit") return onExit?.();
      if (!navigable) return;
      if (onPositionChange) {
        const from = { index, step: step ?? 0 };
        const to = movePosition(action, from, total, stepsOf ?? (() => 0), isAuto);
        if (!samePosition(from, to)) onPositionChange(to);
        return;
      }
      const next = nextIndex(action, index, total);
      if (next !== index) onIndexChange(next);
    },
    [index, step, stepsOf, isAuto, total, navigable, onIndexChange, onPositionChange, onExit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = navActionFor(e.key);
      if (!action) return;
      e.preventDefault();
      go(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const fullscreen = () => {
    void root.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div ref={root} className="relative flex h-full w-full items-center justify-center bg-os-bg" data-testid="present-stage">
      <div
        className="cursor-pointer"
        style={{ width, aspectRatio: "16 / 9" }}
        onClick={() => go("next")}
        data-testid="present-slide"
      >
        {slideId && width > 0 ? (
          transitions ? (
            <SlideTransitionStage slides={transitions.slides} themeId={transitions.themeId} slideId={slideId} step={step} enterStep={enterStep} width={width} renderSlide={renderSlide} />
          ) : (
            renderSlide(slideId, { width, step, enterStep })
          )
        ) : null}
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2">
        {desktop ? (
          <span className="rounded-os-item bg-os-card px-2.5 py-1 text-xs text-os-grey">Press ⌃⌘F for full screen</span>
        ) : (
          typeof document !== "undefined" &&
          document.fullscreenEnabled && (
            <Button variant="ghost" size="xs" onClick={fullscreen} aria-label="Full screen">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              Full screen
            </Button>
          )
        )}
      </div>
      {children}
    </div>
  );
}
