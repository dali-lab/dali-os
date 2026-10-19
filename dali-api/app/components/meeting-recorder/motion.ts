export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const REDUCED_MAX_MS = 120;

export const DUR = {
  barResize: 240,
  swapOut: 120,
  swapIn: 200,
  swapRisePx: 4,
  barFill: 320,
  barFillStagger: 12,
  speaker: 260,
  speakerStagger: 5,
  avatar: 180,
  avatarStagger: 60,
  enhanceButton: 200,
  enhanceButtonDelay: 200,
  wash: 1100,
  bloomTint: 360,
  bloomEdge: 240,
  bloomText: 260,
  bloomTextRisePx: 8,
  bloomStagger: 90,
  wasIn: 220,
  wasInDelay: 120,
  wasOut: 200,
  drainTint: 240,
  drainEdge: 200,
  drainStagger: 70,
  revertFade: 200,
  pill: 120,
  card: 140,
  chip: 200,
  chipStagger: 60,
  chipGap: 40,
  ownerIn: 180,
  taskChip: 220,
  taskChipStagger: 90,
} as const;

export type AnimationHandle = Promise<void> & { cancel: () => void };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function canAnimate(el: Element | null | undefined): el is Element {
  return Boolean(el) && typeof (el as Element).animate === "function";
}

export function reduceFrames(frames: Keyframe[]): Keyframe[] {
  const faded: Keyframe[] = [];
  for (const f of frames) {
    if (!("opacity" in f)) continue;
    faded.push(f.offset === undefined ? { opacity: f.opacity } : { opacity: f.opacity, offset: f.offset });
  }
  return faded.length > 0 ? faded : [{ opacity: 0 }, { opacity: 1 }];
}

export function animate(
  el: Element | null | undefined,
  frames: Keyframe[],
  ms: number,
  opts: { delay?: number; fill?: FillMode } = {},
): AnimationHandle {
  if (!canAnimate(el)) return Object.assign(Promise.resolve(), { cancel: () => {} });
  const reduced = prefersReducedMotion();
  const animation = el.animate(reduced ? reduceFrames(frames) : frames, {
    duration: reduced ? Math.min(ms, REDUCED_MAX_MS) : ms,
    delay: reduced ? 0 : (opts.delay ?? 0),
    easing: EASE,
    fill: opts.fill ?? "backwards",
  });
  const done = new Promise<void>((resolve) => {
    animation.onfinish = () => resolve();
    animation.oncancel = () => resolve();
  });
  return Object.assign(done, { cancel: () => animation.cancel() });
}

export function enterRef(frames: Keyframe[], ms: number, opts: { delay?: number } = {}): (el: HTMLElement | null) => void {
  return (el) => {
    if (el) void animate(el, frames, ms, opts);
  };
}

export const POP_FRAMES = (from: number): Keyframe[] => [
  { opacity: 0, transform: `scale(${from})` },
  { opacity: 1, transform: "scale(1)" },
];
