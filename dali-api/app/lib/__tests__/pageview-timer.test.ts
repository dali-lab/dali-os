import { describe, it, expect } from "vitest";
import {
  MAX_TICK_GAP_MS,
  MAX_VIEW_MS,
  TICK_MS,
  advanceTimer,
  isCounting,
  pendingFlush,
  startTimer,
} from "~/lib/pageview-timer";

describe("isCounting", () => {
  it("needs a visible document", () => {
    expect(isCounting({ documentVisible: false, frameRendered: null })).toBe(false);
  });
  it("counts a visible top-level document", () => {
    expect(isCounting({ documentVisible: true, frameRendered: null })).toBe(true);
  });
  it("does not count a hidden iframe", () => {
    expect(isCounting({ documentVisible: true, frameRendered: false })).toBe(false);
  });
  it("counts a rendered iframe", () => {
    expect(isCounting({ documentVisible: true, frameRendered: true })).toBe(true);
  });
});

describe("advanceTimer", () => {
  it("accumulates while counting", () => {
    let t = startTimer(0, true);
    t = advanceTimer(t, TICK_MS, true);
    t = advanceTimer(t, TICK_MS * 2, true);
    expect(t.ms).toBe(TICK_MS * 2);
  });

  it("does not accumulate while not counting", () => {
    let t = startTimer(0, false);
    t = advanceTimer(t, TICK_MS, false);
    t = advanceTimer(t, TICK_MS * 2, false);
    expect(t.ms).toBe(0);
  });

  it("attributes each interval to the state at its start", () => {
    let t = startTimer(0, false);
    t = advanceTimer(t, TICK_MS, true);
    expect(t.ms).toBe(0);
    t = advanceTimer(t, TICK_MS * 2, true);
    expect(t.ms).toBe(TICK_MS);
    t = advanceTimer(t, TICK_MS * 2 + 1_200, false);
    expect(t.ms).toBe(TICK_MS + 1_200);
    t = advanceTimer(t, TICK_MS * 4, false);
    expect(t.ms).toBe(TICK_MS + 1_200);
  });

  it("ignores suspended gaps beyond the tick tolerance", () => {
    let t = startTimer(0, true);
    t = advanceTimer(t, 60 * 60 * 1000, true);
    expect(t.ms).toBe(MAX_TICK_GAP_MS);
  });

  it("caps a view at 30 minutes", () => {
    let t = startTimer(0, true);
    let now = 0;
    for (let i = 0; i < 1000; i++) {
      now += TICK_MS;
      t = advanceTimer(t, now, true);
    }
    expect(t.ms).toBe(MAX_VIEW_MS);
  });

  it("never goes backwards when the clock does", () => {
    let t = startTimer(10_000, true);
    t = advanceTimer(t, 5_000, true);
    expect(t.ms).toBe(0);
  });
});

describe("pendingFlush", () => {
  it("sends nothing before any time accrues", () => {
    expect(pendingFlush(startTimer(0, true))).toBeNull();
  });

  it("sends the total and remembers it", () => {
    let t = startTimer(0, true);
    t = advanceTimer(t, TICK_MS, true);
    const first = pendingFlush(t)!;
    expect(first.durationMs).toBe(TICK_MS);
    expect(pendingFlush(first.next)).toBeNull();
  });

  it("sends the larger total on a later flush", () => {
    let t = startTimer(0, true);
    t = advanceTimer(t, TICK_MS, true);
    t = pendingFlush(t)!.next;
    t = advanceTimer(t, TICK_MS * 2, true);
    expect(pendingFlush(t)!.durationMs).toBe(TICK_MS * 2);
  });
});
