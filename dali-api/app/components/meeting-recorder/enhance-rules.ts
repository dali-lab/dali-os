import { DUR } from "./motion";
import { BLOCK_CONTENT, blockSelector } from "./block-style-rules";

export const NARROW_BREAKPOINT = 700;
export const CHIP_GUTTER_PX = 12;
export const CHIP_BELOW_PX = 8;
export const WAS_RESERVE_PX = 28;

export type Variant = "a" | "b";
export type TransitionKind = "bloom" | "drain" | "revert";
export type MarkMotion = { id: string; kind: TransitionKind; delay: number; variant: Variant };

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function each(ids: readonly string[], render: (selector: string) => string): string {
  const out: string[] = [];
  for (const id of ids) {
    const selector = blockSelector(id);
    if (selector) out.push(render(selector));
  }
  return out.join("\n");
}

export function wasSpaceCss(ids: readonly string[]): string {
  return each(ids, (s) => `${s} ${BLOCK_CONTENT} { padding-bottom: ${WAS_RESERVE_PX}px; }`);
}

export type ChipSpace = { id: string; width: number; height: number };

export function chipSpaceCss(entries: readonly ChipSpace[]): string {
  const wide = entries.flatMap((e) => {
    const s = blockSelector(e.id);
    return s ? [`${s} ${BLOCK_CONTENT} { padding-right: ${Math.ceil(e.width) + CHIP_GUTTER_PX}px; }`] : [];
  });
  const narrow = entries.flatMap((e) => {
    const s = blockSelector(e.id);
    return s ? [`${s} ${BLOCK_CONTENT} { padding-bottom: ${Math.ceil(e.height) + CHIP_BELOW_PX}px; }`] : [];
  });
  if (entries.length === 0) return "";
  return [
    `@media (min-width: ${NARROW_BREAKPOINT}px) {\n${wide.join("\n")}\n}`,
    `@media (max-width: ${NARROW_BREAKPOINT - 1}px) {\n${narrow.join("\n")}\n}`,
  ].join("\n");
}

type Layer = { name: string; ms: number; delay: number; origin?: string };

const LAYERS: Record<TransitionKind, (v: Variant, delay: number) => { before: Layer; after: Layer }> = {
  bloom: (v, delay) => ({
    before: { name: `enhance-tint-in-${v}`, ms: DUR.bloomTint, delay },
    after: { name: `enhance-edge-in-${v}`, ms: DUR.bloomEdge, delay, origin: "top center" },
  }),
  drain: (v, delay) => ({
    before: { name: `enhance-tint-out-${v}`, ms: DUR.drainTint, delay },
    after: { name: `enhance-edge-out-${v}`, ms: DUR.drainEdge, delay: delay + DUR.drainTint, origin: "bottom center" },
  }),
  revert: (v, delay) => ({
    before: { name: `enhance-fade-out-${v}`, ms: DUR.revertFade, delay },
    after: { name: `enhance-edge-out-${v}`, ms: DUR.revertFade, delay, origin: "bottom center" },
  }),
};

function animation(layer: Layer): string {
  return `animation: ${layer.name} ${layer.ms}ms ${EASE} ${layer.delay}ms both;`;
}

export function markMotionCss(motions: readonly MarkMotion[]): string {
  return motions
    .map(({ id, kind, delay, variant }) => {
      const s = blockSelector(id);
      if (!s) return "";
      const { before, after } = LAYERS[kind](variant, delay);
      return [
        `${s} > .bn-block { position: relative; isolation: isolate; background-color: transparent; box-shadow: none; }`,
        `${s} > .bn-block > .bn-block-content[data-background-color] { background-color: transparent; }`,
        `${s} > .bn-block::before { content: ""; position: absolute; z-index: -1; pointer-events: none; inset: 0; border-radius: 4px; background: var(--enhance-tint); transform-origin: left center; ${animation(before)} }`,
        `${s} > .bn-block::after { content: ""; position: absolute; z-index: -1; pointer-events: none; top: 0; bottom: 0; left: 0; width: 3px; background: var(--enhance-edge); transform-origin: ${after.origin}; ${animation(after)} }`,
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function washCss(id: string | null, variant: Variant): string {
  const s = id ? blockSelector(id) : null;
  if (!s) return "";
  return `${s} ${BLOCK_CONTENT} { background-image: linear-gradient(90deg, transparent, color-mix(in srgb, var(--enhance-edge) 22%, transparent), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: enhance-wash-${variant} ${DUR.wash}ms linear both; }`;
}

export function otherVariant(v: Variant | undefined): Variant {
  return v === "a" ? "b" : "a";
}
