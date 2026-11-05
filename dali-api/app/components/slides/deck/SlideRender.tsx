import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { SlideBody } from "~/components/slides/SlideBody";
import { cn } from "~/lib/cn";
import { cropFrame } from "./crop";
import { isVisibleAt, visibleBlocks } from "./builds";
import { explicitPlacement, isFreeRendered, type Placed } from "./freeform";
import { layoutById, SLOT_Z, STAGE_H, STAGE_W, type LayoutSlot } from "./layouts";
import { placedStyle, rectStyle, u } from "./units";
import type { RenderElement, RenderSlide } from "./snapshot";
import { ChartBox, IconBox, VideoBox, fillVar } from "./content-render";
import { textStyleCss, themeById, themeVars, type TextStyleId, type ThemeDef } from "./themes";

export { fillVar };

export interface SlotContext {
  slot: LayoutSlot;
  element: RenderElement | undefined;
  /** Where the slot is drawn: its layout rect, or the element's own geometry once it has been moved. */
  placed: Placed;
  /** What SlideRender draws for this slot when nothing replaces it. */
  fallback: ReactNode;
}

export interface FreeContext {
  element: RenderElement;
  placed: Placed;
  fallback: ReactNode;
}

export interface SlideRenderProps {
  slide: RenderSlide;
  theme: ThemeDef | string;
  /** Draws a hint in empty slots. The editor stage turns this on; thumbnails and read-only views leave it off. */
  placeholders?: boolean;
  /** Replaces what a slot draws, for example with a live editor on the current slide. */
  renderSlot?: (ctx: SlotContext) => ReactNode;
  /** Replaces what a free element draws. */
  renderFree?: (ctx: FreeContext) => ReactNode;
  /** The build step to show while presenting. Leave it out to show everything, as the editor and thumbnails do. */
  step?: number;
}

const FLEX_ALIGN = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

interface BoxText {
  placed: Placed;
  style: TextStyleId;
  align: "left" | "center";
  valign: "top" | "center" | "bottom";
  placeholder: string;
  element: RenderElement | undefined;
  placeholders: boolean;
  dataKey: Record<string, string>;
}

function TextBox({ placed, style, align, valign, placeholder, element, placeholders, dataKey }: BoxText) {
  const empty = !element || element.blocks.length === 0;
  return (
    <div
      {...dataKey}
      style={{
        ...placedStyle(placed),
        ...textStyleCss(style),
        display: "flex",
        flexDirection: "column",
        justifyContent: FLEX_ALIGN[valign],
        textAlign: align,
        overflow: "hidden",
      }}
    >
      {empty ? (
        placeholders ? <span style={{ opacity: 0.35 }}>{placeholder}</span> : null
      ) : (
        <SlideBody themed doc={element.blocks} />
      )}
    </div>
  );
}

function ImageBox({ placed, element, placeholders, label, dataKey }: { placed: Placed; element: RenderElement | undefined; placeholders: boolean; label: string; dataKey: Record<string, string> }) {
  const full = placed.w === STAGE_W && placed.h === STAGE_H;
  if (element?.src && element.crop) {
    const f = cropFrame(placed, element.crop);
    return (
      <div {...dataKey} data-cropped style={{ ...placedStyle(placed), overflow: "hidden", borderRadius: full ? 0 : u(24) }}>
        <img
          src={element.src}
          alt={element.alt ?? ""}
          style={{ position: "absolute", left: u(f.left), top: u(f.top), width: u(f.w), height: u(f.h), maxWidth: "none", objectFit: "cover" }}
        />
      </div>
    );
  }
  if (element?.src) {
    return (
      <img
        {...dataKey}
        src={element.src}
        alt={element.alt ?? ""}
        style={{ ...placedStyle(placed), objectFit: "cover", borderRadius: full ? 0 : u(24) }}
      />
    );
  }
  if (!placeholders) return null;
  return (
    <div
      {...dataKey}
      style={{
        ...placedStyle(placed),
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
        {label}
      </span>
    </div>
  );
}

function ShapeBox({ placed, element }: { placed: Placed; element: RenderElement }) {
  const shape = element.shape ?? "rect";
  const color = fillVar(element.fill);
  const dataKey = { "data-element": element.id, "data-shape": shape };
  if (shape === "line" || shape === "arrow") {
    const { w, h } = placed;
    return (
      <svg {...dataKey} viewBox={`0 0 ${w} ${h}`} style={{ ...placedStyle(placed), overflow: "visible", fill: color }} aria-hidden>
        {shape === "line" ? (
          <rect x={0} y={0} width={w} height={h} />
        ) : (
          <>
            <rect x={0} y={h * 0.375} width={Math.max(0, w - h)} height={h * 0.25} />
            <polygon points={`${Math.max(0, w - h)},0 ${w},${h / 2} ${Math.max(0, w - h)},${h}`} />
          </>
        )}
      </svg>
    );
  }
  const radius = shape === "ellipse" ? "50%" : shape === "rounded" ? u(Math.min(48, placed.w / 4, placed.h / 4)) : 0;
  return <div {...dataKey} style={{ ...placedStyle(placed), background: color, borderRadius: radius }} />;
}

function FreeBox({ element, placed, placeholders, theme }: { element: RenderElement; placed: Placed; placeholders: boolean; theme: ThemeDef }) {
  const dataKey = { "data-element": element.id };
  if (element.kind === "text") {
    return (
      <TextBox
        placed={placed}
        style={element.textStyle ?? "body"}
        align="left"
        valign="top"
        placeholder="Text"
        element={element}
        placeholders={placeholders}
        dataKey={dataKey}
      />
    );
  }
  if (element.kind === "image") return <ImageBox placed={placed} element={element} placeholders={placeholders} label="Add an image" dataKey={dataKey} />;
  if (element.kind === "shape") return <ShapeBox placed={placed} element={element} />;
  if (element.kind === "chart") return <ChartBox placed={placed} element={element} theme={theme} />;
  if (element.kind === "icon") return <IconBox placed={placed} element={element} />;
  if (element.kind === "video") return <VideoBox placed={placed} element={element} />;
  return null;
}

const slotName = (slot: string) => slot.charAt(0).toUpperCase() + slot.slice(1);

function SlotGhost({ slot }: { slot: LayoutSlot }) {
  return (
    <div
      data-slot-ghost={slot.slot}
      aria-hidden
      style={{
        ...rectStyle(slot.rect),
        border: `${u(3)} dashed var(--slide-rule)`,
        borderRadius: u(12),
        color: "var(--slide-muted)",
        display: "grid",
        placeItems: "center",
        fontSize: u(28),
        fontFamily: "var(--slide-font-body)",
        pointerEvents: "none",
      }}
    >
      {slotName(slot.slot)} slot · empty
    </div>
  );
}

type Item =
  | { z: number; kind: "slot"; slot: LayoutSlot; element: RenderElement | undefined }
  | { z: number; kind: "free"; element: RenderElement; placed: Placed };

/**
 * A slide drawn from data and the theme alone. It fills the width of its parent at 16:9 and sizes everything
 * from `--slide-u`, one stage unit of the 1920 by 1080 design, so text and popups inside it keep their real size.
 */
export function SlideRender({ slide, theme, placeholders = false, renderSlot, renderFree, step, className }: SlideRenderProps & { className?: string }) {
  const def = typeof theme === "string" ? themeById(theme) : theme;
  const layout = layoutById(slide.layoutId);
  const visible = (el: RenderElement | undefined) => !(step !== undefined && el && !isVisibleAt(el, step));
  const items: Item[] = [
    ...layout.slots.map((slot): Item => {
      const found = slide.elements.find((e) => e.slot === slot.slot);
      return { z: found?.z ?? SLOT_Z[slot.slot], kind: "slot", slot, element: found };
    }),
    ...slide.elements.flatMap((element): Item[] => {
      if (!isFreeRendered(slide.layoutId, element) || !visible(element)) return [];
      const shown = step !== undefined && element.buildBullets ? { ...element, blocks: visibleBlocks(element, element.blocks, step) } : element;
      return [{ z: element.z, kind: "free", element: shown, placed: explicitPlacement(element)! }];
    }),
  ].sort((a, b) => a.z - b.z);
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
        {items.map((item) => {
          if (item.kind === "free") {
            const fallback = <FreeBox element={item.element} placed={item.placed} placeholders={placeholders} theme={def} />;
            return <Fragment key={item.element.id}>{renderFree ? renderFree({ element: item.element, placed: item.placed, fallback }) : fallback}</Fragment>;
          }
          const { slot, element: found } = item;
          if (!visible(found)) return null;
          const element = step !== undefined && found?.buildBullets ? { ...found, blocks: visibleBlocks(found, found.blocks, step) } : found;
          const placed = (element && explicitPlacement(element)) || { ...slot.rect, rot: 0 };
          const detached = Boolean(element && explicitPlacement(element));
          const dataKey = { "data-slot": slot.slot };
          const fallback =
            slot.kind === "image" ? (
              <ImageBox placed={placed} element={element} placeholders={placeholders} label={slot.placeholder} dataKey={dataKey} />
            ) : (
              <TextBox
                placed={placed}
                style={element?.textStyle ?? slot.style}
                align={slot.align}
                valign={slot.valign}
                placeholder={slot.placeholder}
                element={element}
                placeholders={placeholders}
                dataKey={dataKey}
              />
            );
          const ghost = placeholders && detached ? <SlotGhost slot={slot} /> : null;
          return (
            <Fragment key={slot.slot}>
              {ghost}
              {renderSlot ? renderSlot({ slot, element, placed, fallback }) : fallback}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** A slide in a box of the parent's width: the form the filmstrip and read-only view use. */
export function ScaledSlide(props: SlideRenderProps & { className?: string }) {
  return <SlideRender {...props} />;
}
