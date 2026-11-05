import type { RenderElement, RenderSlide } from "./snapshot";

export interface DeckPosition {
  index: number;
  step: number;
}

export type NavMove = "next" | "prev" | "first" | "last";

export function buildOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 0;
}

const own = (el: RenderElement) => el.build ?? 0;

export function bulletCount(el: RenderElement): number {
  return el.buildBullets ? el.blocks.length : 0;
}

/** How many steps a slide has after its first view. Zero means nothing on it builds. */
export function buildSteps(slide: RenderSlide): number {
  let steps = 0;
  for (const el of slide.elements) steps = Math.max(steps, own(el) + bulletCount(el));
  return steps;
}

export function isVisibleAt(el: RenderElement, step: number): boolean {
  return own(el) <= step;
}

/** The blocks of a bullets slot shown at `step`: none at its own step, one more at each step after. */
export function visibleBlocks<T>(el: RenderElement, blocks: T[], step: number): T[] {
  if (!el.buildBullets) return blocks;
  return blocks.slice(0, Math.max(0, Math.min(step - own(el), blocks.length)));
}

export function movePosition(move: NavMove, pos: DeckPosition, total: number, stepsOf: (index: number) => number): DeckPosition {
  if (total <= 0) return pos;
  if (move === "first") return { index: 0, step: 0 };
  if (move === "last") return { index: total - 1, step: stepsOf(total - 1) };
  if (move === "next") {
    if (pos.step < stepsOf(pos.index)) return { index: pos.index, step: pos.step + 1 };
    return pos.index < total - 1 ? { index: pos.index + 1, step: 0 } : pos;
  }
  if (pos.step > 0) return { index: pos.index, step: pos.step - 1 };
  return pos.index > 0 ? { index: pos.index - 1, step: stepsOf(pos.index - 1) } : pos;
}

export const samePosition = (a: DeckPosition, b: DeckPosition) => a.index === b.index && a.step === b.step;
