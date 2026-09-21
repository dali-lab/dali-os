import { describe, it, expect } from "vitest";
import {
  STANDARD_TIMELINE,
  canInsertAt,
  canRemove,
  defaultTimeline,
  delibRounds,
  hasInterviews,
  newRoundId,
  parseTimeline,
  validateTimeline,
  weekIssues,
  weeksLabel,
  type Timeline,
} from "~/hiring/lib/cycle-timeline";

const round = (id: string, a: number, b = a) => ({ kind: "delib" as const, id, label: id, weeks: [a, b] as [number, number] });
const ph = (key: any, a: number, b = a) => ({ kind: "phase" as const, key, weeks: [a, b] as [number, number] });
const base = [ph("setup", 1, 5), ph("review", 6)];

describe("defaultTimeline", () => {
  it("is today's timeline for Students", () => {
    expect(STANDARD_TIMELINE.map((b) => [b.kind === "phase" ? b.key : b.id, weeksLabel(b)])).toEqual([
      ["setup", "Week 1–5"],
      ["review", "Week 6"],
      ["first", "Week 6"],
      ["interviews", "Week 7"],
      ["final", "Week 8"],
      ["decisions", "Week 9"],
    ]);
  });

  it("drops the first round and Interviews when a cycle has neither", () => {
    const t = defaultTimeline({ firstDelib: false, interviews: false });
    expect(t.map((b) => (b.kind === "phase" ? b.key : b.id))).toEqual(["setup", "review", "final", "decisions"]);
    expect(validateTimeline(t)).toBeNull();
  });
});

describe("validateTimeline", () => {
  it("accepts extra rounds anywhere between Review and Decisions", () => {
    const t: Timeline = [...base, round("a", 6), round("b", 7), ph("interviews", 7), round("c", 8), round("d", 8), ph("decisions", 9)];
    expect(validateTimeline(t)).toBeNull();
  });

  it("needs a round right before Interviews and one after it", () => {
    expect(validateTimeline([...base, ph("interviews", 7), round("f", 8), ph("decisions", 9)])).toMatch(/right before/);
    expect(validateTimeline([...base, round("a", 6), ph("interviews", 7), ph("decisions", 9)])).toMatch(/after it/);
  });

  it("needs at least one round and keeps the fixed phases in place", () => {
    expect(validateTimeline([...base, ph("decisions", 9)])).toMatch(/at least one delib round/);
    expect(validateTimeline([ph("review", 1), ph("setup", 2), round("f", 8), ph("decisions", 9)])).toMatch(/come first/);
  });

  it("checks weeks: in range, start ≤ end, in order", () => {
    expect(validateTimeline([...base, round("f", 5), ph("decisions", 9)])).toMatch(/^f starts before the block ahead of it\./);
    expect(validateTimeline([...base, round("f", 8, 7), ph("decisions", 9)])).toBeTruthy();
  });
});

describe("parseTimeline", () => {
  it("falls back when nothing usable is stored", () => {
    expect(parseTimeline(null)).toBe(STANDARD_TIMELINE);
    expect(parseTimeline([{ kind: "phase", key: "setup", weeks: [1, 4] }])).toBe(STANDARD_TIMELINE);
  });

  it("reads a valid stored timeline", () => {
    const t = defaultTimeline({ firstDelib: false, interviews: false });
    expect(parseTimeline(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
});

describe("delibRounds", () => {
  it("gives each round its columns from where it sits", () => {
    const t: Timeline = [...base, round("a", 6), round("b", 6), ph("interviews", 7), round("c", 8), round("d", 8), ph("decisions", 9)];
    const r = delibRounds(t);
    expect(r.map((x) => [x.id, x.advanceColumn, x.isFinal, x.afterInterviews])).toEqual([
      ["a", "Advance", false, false],
      ["b", "Interview", false, false],
      ["c", "Advance", false, true],
      ["d", null, true, false],
    ]);
    expect(r[3].columns).toEqual(["Accept", "Waitlist", "Reject"]);
    expect(hasInterviews(t)).toBe(true);
  });
});

describe("editing", () => {
  it("never removes a fixed phase, the round Interviews depends on, or a round with a board", () => {
    const t = STANDARD_TIMELINE;
    const setup = t[0];
    const first = t.find((b) => b.kind === "delib" && b.id === "first")!;
    const interviews = t.find((b) => b.kind === "phase" && b.key === "interviews")!;
    const final = t.find((b) => b.kind === "delib" && b.id === "final")!;
    expect(canRemove(t, setup)).toBe(false);
    expect(canRemove(t, first)).toBe(false); // Interviews needs it
    expect(canRemove(t, final)).toBe(false); // Interviews needs a round after
    expect(canRemove(t, interviews)).toBe(true);
    const noInterviews = t.filter((b) => b !== interviews);
    expect(canRemove(noInterviews, noInterviews.find((b) => b.kind === "delib" && b.id === "first")!)).toBe(true);
    expect(canRemove(noInterviews, noInterviews.find((b) => b.kind === "delib" && b.id === "first")!, new Set(["first"]))).toBe(false);
  });

  it("only offers Add slots that keep the timeline valid", () => {
    const t = STANDARD_TIMELINE;
    expect(canInsertAt(t, 1, round("x", 1))).toBe(false); // before Review
    expect(canInsertAt(t, 3, round("x", 6))).toBe(true); // after the first round
    expect(newRoundId(t)).toBe("r3");
  });
});

describe("weekIssues", () => {
  it("flags exactly the rows whose weeks don't line up", () => {
    const t: Timeline = [
      ph("setup", 1, 5),
      ph("review", 4), // overlaps Setup, which is fine
      round("a", 3), // starts before Review (4)
      round("b", 9, 8), // ends before it starts
      ph("decisions", 16), // outside the term
    ];
    expect(weekIssues(t)).toEqual([
      null,
      null,
      "starts before the block ahead of it",
      "ends before it starts",
      "runs outside weeks 1 to 15",
    ]);
  });

  it("finds nothing wrong with the standard timeline", () => {
    expect(weekIssues(STANDARD_TIMELINE).every((x) => x === null)).toBe(true);
  });
});
