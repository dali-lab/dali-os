import type { RenderElement, RenderSlide } from "./snapshot";

export interface DeckPosition {
  index: number;
  step: number;
}

export type NavMove = "next" | "prev" | "first" | "last";

export function buildOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 0;
}

export const BUILD_EFFECTS = ["appear", "fade", "rise", "scale"] as const;
export type BuildEffect = (typeof BUILD_EFFECTS)[number];
export const DEFAULT_EFFECT: BuildEffect = "fade";
export const BUILD_ANIM_MS = 300;
export const MAX_BUILD_DELAY = 5000;

export const effectOf = (el: { buildEffect?: BuildEffect }): BuildEffect => el.buildEffect ?? DEFAULT_EFFECT;

export interface BuildFields {
  build?: number;
  buildBullets?: true;
  buildEffect?: BuildEffect;
  buildAfter?: true;
  buildDelay?: number;
}

export function cleanBuildFields(read: (key: string) => unknown): BuildFields {
  const build = buildOf(read("build"));
  const effect = read("buildEffect");
  const delay = read("buildDelay");
  const after = read("buildAfter") === true;
  return {
    ...(build ? { build } : {}),
    ...(read("buildBullets") === true ? { buildBullets: true as const } : {}),
    ...(BUILD_EFFECTS.includes(effect as BuildEffect) ? { buildEffect: effect as BuildEffect } : {}),
    ...(after ? { buildAfter: true as const } : {}),
    ...(after && typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? { buildDelay: Math.min(MAX_BUILD_DELAY, Math.round(delay)) } : {}),
  };
}

const own = (el: RenderElement) => el.build ?? 0;
const bulleted = (el: RenderElement) => el.buildBullets === true && el.blocks.length > 0;

export function bulletCount(el: RenderElement): number {
  return bulleted(el) ? el.blocks.length : 0;
}

/** The step an element first shows at. A bullets box shows with its first bullet, so never before step 1. */
export function startOf(el: RenderElement): number {
  return bulleted(el) ? Math.max(own(el), 1) : own(el);
}

/** How many steps an element takes to finish appearing. */
export function spanOf(el: RenderElement): number {
  return bulleted(el) ? el.blocks.length : 1;
}

export function isBuilt(el: RenderElement): boolean {
  return startOf(el) >= 1;
}

/** How many steps a slide has after its first view. Zero means nothing on it builds. */
export function buildSteps(slide: RenderSlide): number {
  let steps = 0;
  for (const el of slide.elements) if (isBuilt(el)) steps = Math.max(steps, startOf(el) + spanOf(el) - 1);
  return steps;
}

export function isVisibleAt(el: RenderElement, step: number): boolean {
  return startOf(el) <= step;
}

/** The blocks of a bullets slot shown at `step`: the first with the box, one more at each step after. */
export function visibleBlocks<T>(el: RenderElement, blocks: T[], step: number): T[] {
  if (!bulleted(el)) return blocks;
  return blocks.slice(0, Math.max(0, Math.min(step - startOf(el) + 1, blocks.length)));
}

/** Milliseconds to wait after the previous step before `step` plays by itself, or null when it waits for a key press. */
export function autoDelayAt(slide: RenderSlide, step: number): number | null {
  if (step < 1) return null;
  let delay: number | null = null;
  for (const el of slide.elements) {
    if (el.buildAfter && isBuilt(el) && startOf(el) === step) delay = Math.max(delay ?? 0, el.buildDelay ?? 0);
  }
  return delay;
}

export interface Entering {
  id: string;
  slot: string | null;
  effect: BuildEffect;
  bullet: boolean;
}

/** What appears when the presenter lands on `step` from the one before it. */
export function enteringAt(slide: RenderSlide, step: number): Entering[] {
  const out: Entering[] = [];
  for (const el of slide.elements) {
    if (!isBuilt(el)) continue;
    const start = startOf(el);
    if (step === start) out.push({ id: el.id, slot: el.slot, effect: effectOf(el), bullet: false });
    else if (step > start && step < start + spanOf(el)) out.push({ id: el.id, slot: el.slot, effect: effectOf(el), bullet: true });
  }
  return out;
}

/** Going back skips steps that play by themselves, so back lands where the presenter last waited. */
function restingBefore(index: number, step: number, isAuto: (index: number, step: number) => boolean): number {
  for (let t = step - 1; t > 0; t--) if (!isAuto(index, t + 1)) return t;
  return 0;
}

export function movePosition(
  move: NavMove,
  pos: DeckPosition,
  total: number,
  stepsOf: (index: number) => number,
  isAuto: (index: number, step: number) => boolean = () => false,
): DeckPosition {
  if (total <= 0) return pos;
  if (move === "first") return { index: 0, step: 0 };
  if (move === "last") return { index: total - 1, step: stepsOf(total - 1) };
  if (move === "next") {
    if (pos.step < stepsOf(pos.index)) return { index: pos.index, step: pos.step + 1 };
    return pos.index < total - 1 ? { index: pos.index + 1, step: 0 } : pos;
  }
  if (pos.step > 0) return { index: pos.index, step: restingBefore(pos.index, pos.step, isAuto) };
  return pos.index > 0 ? { index: pos.index - 1, step: stepsOf(pos.index - 1) } : pos;
}

export const samePosition = (a: DeckPosition, b: DeckPosition) => a.index === b.index && a.step === b.step;
