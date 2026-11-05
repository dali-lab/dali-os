import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { SlideBody } from "~/components/slides/SlideBody";
import { cn } from "~/lib/cn";
import { layoutById, STAGE_H, STAGE_W, type LayoutSlot } from "./layouts";
import { rectStyle, u } from "./units";
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

function TextSlot({ slot, element, placeholders }: { slot: LayoutSlot; element: RenderElement | undefined; placeholders: boolean }) {
  const style = element?.textStyle ?? slot.style;
  const empty = !element || element.blocks.length === 0;
  return (
    <div
      data-slot={slot.slot}
      style={{
        ...rectStyle(slot.rect),
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
        style={{ ...rectStyle(slot.rect), objectFit: "cover", borderRadius: full ? 0 : u(24) }}
      />
    );
  }
  if (!placeholders) return null;
  return (
    <div
      data-slot="image"
      style={{
        ...rectStyle(slot.rect),
        background: "var(--slide-surface)",
        color: "var(--slide-muted)",
        borderRadius: full ? 0 : u(24),
        display: "grid",
        placeItems: "center",
        fontSize: u(32),
        fontFamily: "var(--slide-font-body)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(16) }}>
        <ImageIcon style={{ width: u(72), height: u(72) }} aria-hidden />
        {slot.placeholder}
      </span>
    </div>
  );
}

/**
 * A slide drawn from data and the theme alone. It fills the width of its parent at 16:9 and sizes everything
 * from `--slide-u`, one stage unit of the 1920 by 1080 design, so text and popups inside it keep their real size.
 */
export function SlideRender({ slide, theme, placeholders = false, renderSlot, className }: SlideRenderProps & { className?: string }) {
  const def = typeof theme === "string" ? themeById(theme) : theme;
  const layout = layoutById(slide.layoutId);
  return (
    <div className={cn("relative w-full overflow-hidden", className)} style={{ containerType: "inline-size", aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
      <div
        data-slide-stage
        data-layout={layout.id}
        data-theme={def.id}
        style={{
          ...(themeVars(def) as CSSProperties),
          ["--slide-u" as string]: `calc(100cqw / ${STAGE_W})`,
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: "var(--slide-ground)",
          color: "var(--slide-fg)",
          fontFamily: "var(--slide-font-body)",
          fontSize: u(40),
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
    </div>
  );
}

/** A slide in a box of the parent's width: the form the filmstrip and read-only view use. */
export function ScaledSlide(props: SlideRenderProps & { className?: string }) {
  return <SlideRender {...props} />;
}
