import { Fragment, useRef, type CSSProperties, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { SlideBody } from "~/components/slides/SlideBody";
import { useScaleToFit } from "~/components/slides/useScaleToFit";
import { cn } from "~/lib/cn";
import { layoutById, STAGE_H, STAGE_W, type LayoutSlot } from "./layouts";
import type { RenderElement, RenderSlide } from "./snapshot";
import { textStyleCss, themeById, themeVars, type ThemeDef } from "./themes";

export interface SlotContext {
  slot: LayoutSlot;
  element: RenderElement | undefined;
  /** What SlideRender draws for this slot when nothing replaces it. */
  fallback: ReactNode;
}

export interface SlideRenderProps {
  slide: RenderSlide;
  theme: ThemeDef | string;
  /** Draws a hint in empty slots. The editor stage turns this on; thumbnails and read-only views leave it off. */
  placeholders?: boolean;
  /** Replaces what a slot draws, for example with a live editor on the current slide. */
  renderSlot?: (ctx: SlotContext) => ReactNode;
}

const FLEX_ALIGN = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

function rectStyle(slot: LayoutSlot): CSSProperties {
  const { x, y, w, h } = slot.rect;
  return { position: "absolute", left: x, top: y, width: w, height: h };
}

function TextSlot({ slot, element, placeholders }: { slot: LayoutSlot; element: RenderElement | undefined; placeholders: boolean }) {
  const style = element?.textStyle ?? slot.style;
  const empty = !element || element.blocks.length === 0;
  return (
    <div
      data-slot={slot.slot}
      style={{
        ...rectStyle(slot),
        ...textStyleCss(style),
        display: "flex",
        flexDirection: "column",
        justifyContent: FLEX_ALIGN[slot.valign],
        textAlign: slot.align,
        overflow: "hidden",
      }}
    >
      {empty ? (
        placeholders ? <span style={{ opacity: 0.35 }}>{slot.placeholder}</span> : null
      ) : (
        <SlideBody themed doc={element.blocks} />
      )}
    </div>
  );
}

function ImageSlot({ slot, element, placeholders }: { slot: LayoutSlot; element: RenderElement | undefined; placeholders: boolean }) {
  const full = slot.rect.w === STAGE_W && slot.rect.h === STAGE_H;
  if (element?.src) {
    return (
      <img
        data-slot="image"
        src={element.src}
        alt={element.alt ?? ""}
        style={{ ...rectStyle(slot), objectFit: "cover", borderRadius: full ? 0 : 24 }}
      />
    );
  }
  if (!placeholders) return null;
  return (
    <div
      data-slot="image"
      style={{
        ...rectStyle(slot),
        background: "var(--slide-surface)",
        color: "var(--slide-muted)",
        borderRadius: full ? 0 : 24,
        display: "grid",
        placeItems: "center",
        fontSize: 32,
        fontFamily: "var(--slide-font-body)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <ImageIcon width={72} height={72} aria-hidden />
        {slot.placeholder}
      </span>
    </div>
  );
}

/** A slide on its 1920 by 1080 stage, drawn only from data and the theme. It owns no state and no editors. */
export function SlideRender({ slide, theme, placeholders = false, renderSlot }: SlideRenderProps) {
  const def = typeof theme === "string" ? themeById(theme) : theme;
  const layout = layoutById(slide.layoutId);
  return (
    <div
      data-slide-stage
      data-layout={layout.id}
      data-theme={def.id}
      style={{
        ...(themeVars(def) as CSSProperties),
        position: "relative",
        width: STAGE_W,
        height: STAGE_H,
        overflow: "hidden",
        background: "var(--slide-ground)",
        color: "var(--slide-fg)",
        fontFamily: "var(--slide-font-body)",
      }}
    >
      {layout.slots.map((slot) => {
        const element = slide.elements.find((e) => e.slot === slot.slot);
        const fallback =
          slot.kind === "image" ? (
            <ImageSlot slot={slot} element={element} placeholders={placeholders} />
          ) : (
            <TextSlot slot={slot} element={element} placeholders={placeholders} />
          );
        return <Fragment key={slot.slot}>{renderSlot ? renderSlot({ slot, element, fallback }) : fallback}</Fragment>;
      })}
    </div>
  );
}

/** Scales a 1920 by 1080 child to the width of its box, keeping 16:9. */
export function ScaledStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useScaleToFit(ref, STAGE_W);
  return (
    <div ref={ref} className={cn("relative aspect-video w-full overflow-hidden", className)}>
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A slide scaled to its container: the form the filmstrip and read-only view use. */
export function ScaledSlide({ className, ...props }: SlideRenderProps & { className?: string }) {
  return (
    <ScaledStage className={className}>
      <SlideRender {...props} />
    </ScaledStage>
  );
}
