// Client-safe: imported by PageViewReporter, so no db or node: imports here.

export const MAX_VIEW_MS = 30 * 60 * 1000;
export const TICK_MS = 5_000;
// A tick later than this means the timer was suspended (sleep, throttled tab),
// so the gap is not time on page.
export const MAX_TICK_GAP_MS = TICK_MS * 3;

export type ViewTimer = {
  ms: number;
  lastAt: number;
  wasCounting: boolean;
  lastSentMs: number;
};

export function startTimer(now: number, counting: boolean): ViewTimer {
  return { ms: 0, lastAt: now, wasCounting: counting, lastSentMs: 0 };
}

export function advanceTimer(
  t: ViewTimer,
  now: number,
  counting: boolean,
): ViewTimer {
  const gap = Math.max(0, now - t.lastAt);
  const added = t.wasCounting ? Math.min(gap, MAX_TICK_GAP_MS) : 0;
  return {
    ...t,
    ms: Math.min(MAX_VIEW_MS, t.ms + added),
    lastAt: now,
    wasCounting: counting,
  };
}

export function isCounting(input: {
  documentVisible: boolean;
  frameRendered: boolean | null;
}): boolean {
  return input.documentVisible && input.frameRendered !== false;
}

export function pendingFlush(
  t: ViewTimer,
): { durationMs: number; next: ViewTimer } | null {
  const durationMs = Math.round(t.ms);
  if (durationMs <= 0 || durationMs <= t.lastSentMs) return null;
  return { durationMs, next: { ...t, lastSentMs: durationMs } };
}
