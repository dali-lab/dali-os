import { useRef } from "react";
import { cn } from "~/lib/cn";
import type { Slide } from "~/components/slides/types";
import { SlideLayout } from "./SlideLayout";
import { useScaleToFit } from "./useScaleToFit";

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;

/** A slide at its fixed design size, scaled to the available width so it looks the same everywhere. */
export function SlideCanvas({ slide, number, className }: { slide: Slide; number?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useScaleToFit(ref, SLIDE_WIDTH);
  return (
    <div
      ref={ref}
      className={cn(
        "relative aspect-video w-full overflow-hidden",
        slide.layout === "title" || slide.layout === "image" ? "bg-navy-deep" : "bg-brand-white",
        className,
      )}
    >
      {scale > 0 && (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}
        >
          <SlideLayout slide={slide} number={number} />
        </div>
      )}
    </div>
  );
}
