import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { slideFragment } from "~/components/slides/deck/deck-ops";
import { SlideRender, ScaledStage } from "~/components/slides/deck/SlideRender";
import { STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { SlotEditor, type SlotCollab } from "./SlotEditor";
import type * as Y from "yjs";

/** Editors remount when the slide changes or a restore replaces the deck's fragments. */
export const stageKey = (epoch: number, slideId: string) => `${epoch}:${slideId}`;

/** The biggest 16:9 box that fits its parent. */
export function FitBox({ children }: { children: (width: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(0, Math.floor(Math.min(el.clientWidth, (el.clientHeight * STAGE_W) / STAGE_H))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      {width > 0 && <div style={{ width }}>{children(width)}</div>}
    </div>
  );
}

export function SlideStage({
  slide,
  themeId,
  doc,
  collab,
  editable,
  selectedSlot,
  onSelectSlot,
  onPickImage,
}: {
  slide: RenderSlide;
  themeId: string;
  doc: Y.Doc;
  collab: SlotCollab | null;
  editable: boolean;
  selectedSlot: string | null;
  onSelectSlot: (slot: string) => void;
  onPickImage: () => void;
}) {
  return (
    <FitBox>
      {() => (
        <ScaledStage className="rounded-os-card shadow-sm">
          <SlideRender
            slide={slide}
            theme={themeId}
            placeholders={editable}
            renderSlot={({ slot, element, fallback }) => {
              if (!editable || !collab) return fallback;
              if (slot.kind === "image") {
                return (
                  <>
                    {fallback}
                    <button
                      type="button"
                      aria-label={element?.src ? "Replace image" : "Add image"}
                      onClick={onPickImage}
                      className="absolute opacity-0"
                      style={{ left: slot.rect.x, top: slot.rect.y, width: slot.rect.w, height: slot.rect.h }}
                    />
                  </>
                );
              }
              const fragment = slideFragment(doc, slide.id, slot.slot);
              if (!fragment) return fallback;
              return (
                <SlotEditor
                  slot={slot}
                  style={element?.textStyle ?? slot.style}
                  fragment={fragment}
                  collab={collab}
                  selected={selectedSlot === slot.slot}
                  onFocus={() => onSelectSlot(slot.slot)}
                />
              );
            }}
          />
        </ScaledStage>
      )}
    </FitBox>
  );
}

export function DeletedSlideNotice({ by, onRestore }: { by: string | null; onRestore: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div role="status" className="flex items-center gap-3 rounded-os-card border border-os-container bg-os-card px-4 py-3 text-sm">
        <span>{by ? `Deleted by ${by}` : "This slide was deleted"}</span>
        <Button variant="secondary" size="sm" onClick={onRestore}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Restore
        </Button>
      </div>
    </div>
  );
}
