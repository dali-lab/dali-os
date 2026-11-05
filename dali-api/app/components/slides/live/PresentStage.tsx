import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useDesktopVersion } from "~/lib/desktop";
import { Button } from "~/components/ui/Button";
import { navActionFor, nextIndex } from "./keys";
import type { RenderSlide } from "./types";

export interface PresentStageProps {
  slideIds: string[];
  index: number;
  onIndexChange: (index: number) => void;
  renderSlide: RenderSlide;
  onExit?: () => void;
  navigable?: boolean;
  children?: React.ReactNode;
}

const ASPECT = 16 / 9;

export function PresentStage({ slideIds, index, onIndexChange, renderSlide, onExit, navigable = true, children }: PresentStageProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const desktop = useDesktopVersion() != null;
  const total = slideIds.length;
  const slideId = slideIds[index];

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
      const next = nextIndex(action, index, total);
      if (next !== index) onIndexChange(next);
    },
    [index, total, navigable, onIndexChange, onExit],
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
        {slideId && width > 0 ? renderSlide(slideId, { width }) : null}
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
