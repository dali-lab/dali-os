import { describe, it, expect } from "vitest";
import {
  FIRST_INTERVIEW_ROUND_ID,
  STANDARD_TIMELINE,
  blockKey,
  blockLabel,
  canInsertAt,
  canRemove,
  defaultTimeline,
  delibRounds,
  findInterviewRound,
  groupByInterviewRound,
  hasInterviews,
  interviewRoundForTab,
  interviewRounds,
  newInterviewRound,
  newRoundId,
  nextInterviewRoundId,
  openTimelineChange,
  parseTimeline,
  validateTimeline,
  weekIssues,
  weeksLabel,
  type Timeline,
} from "~/hiring/lib/cycle-timeline";

const round = (id: string, a: number, b = a) => ({ kind: "delib" as const, id, label: id, weeks: [a, b] as [number, number] });
const ph = (key: any, a: number, b = a) => ({ kind: "phase" as const, key, weeks: [a, b] as [number, number] });
const iv = (id: string, a: number, b = a) => ({
  kind: "phase" as const,
  key: "interviews" as const,
  id,
  label: `Interviews ${id.slice(2)}`,
  weeks: [a, b] as [number, number],
});
const base = [ph("setup", 1, 5), ph("review", 6)];
// The standard timeline with a second Interviews round before the final delib.
const TWO_ROUNDS: Timeline = [
  ...base,
  round("first", 6),
  ph("interviews", 7),
  round("r3", 8),
  iv("iv2", 9),
  round("final", 10),
  ph("decisions", 11),
];

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

describe("interview rounds", () => {
  it("accepts a second Interviews round when each has a round before and after", () => {
    expect(validateTimeline(TWO_ROUNDS)).toBeNull();
  });

  it("holds every Interviews round to the round-before and round-after rules", () => {
    const noRoundBefore: Timeline = [...base, round("first", 6), ph("interviews", 7), iv("iv2", 8), round("final", 9), ph("decisions", 10)];
    expect(validateTimeline(noRoundBefore)).toMatch(/right before/);
    const noRoundAfter: Timeline = [...base, round("first", 6), ph("interviews", 7), round("r3", 8), iv("iv2", 9), ph("decisions", 10)];
    expect(validateTimeline(noRoundAfter)).toMatch(/after it/);
  });

  it("refuses two Interviews rounds with the same id", () => {
    const t: Timeline = [...base, round("a", 6), ph("interviews", 7), round("b", 8), ph("interviews", 9), round("c", 10), ph("decisions", 11)];
    expect(validateTimeline(t)).toMatch(/its own id/);
  });

  it("lists rounds in order, the first under the legacy id", () => {
    expect(interviewRounds(TWO_ROUNDS)).toEqual([
      { id: FIRST_INTERVIEW_ROUND_ID, label: "Interviews", index: 0, weeks: [7, 7], key: "interviews" },
      { id: "iv2", label: "Interviews 2", index: 1, weeks: [9, 9], key: "interviews:iv2" },
    ]);
    expect(findInterviewRound(TWO_ROUNDS, "iv2")?.index).toBe(1);
    expect(findInterviewRound(TWO_ROUNDS, "nope")).toBeNull();
    expect(interviewRoundForTab(TWO_ROUNDS, "interviews")?.id).toBe(FIRST_INTERVIEW_ROUND_ID);
    expect(interviewRoundForTab(TWO_ROUNDS, "interviews:iv2")?.id).toBe("iv2");
    expect(interviewRoundForTab(TWO_ROUNDS, "review")).toBeNull();
  });

  it("keys and labels the first round as before and later rounds by id", () => {
    expect(blockKey(ph("interviews", 7))).toBe("interviews");
    expect(blockLabel(ph("interviews", 7))).toBe("Interviews");
    expect(blockKey(iv("iv2", 9))).toBe("interviews:iv2");
    expect(blockLabel(iv("iv2", 9))).toBe("Interviews 2");
  });

  it("tells each round which Interviews round it invites to and follows", () => {
    const r = delibRounds(TWO_ROUNDS);
    expect(r.map((x) => [x.id, x.advanceColumn, x.interviewRoundId, x.afterInterviewRoundId])).toEqual([
      ["first", "Interview", FIRST_INTERVIEW_ROUND_ID, null],
      ["r3", "Interview", "iv2", FIRST_INTERVIEW_ROUND_ID],
      ["final", null, null, "iv2"],
    ]);
  });

  it("numbers a new round after the existing ones", () => {
    expect(newInterviewRound(STANDARD_TIMELINE, [9, 9])).toEqual({
      kind: "phase",
      key: "interviews",
      id: "iv2",
      label: "Interviews 2",
      weeks: [9, 9],
    });
    expect(newInterviewRound(TWO_ROUNDS, [9, 9]).id).toBe("iv3");
  });

  it("sends a hand-made invite to the first round the applicant hasn't done", () => {
    expect(nextInterviewRoundId(TWO_ROUNDS, new Set())).toBe(FIRST_INTERVIEW_ROUND_ID);
    expect(nextInterviewRoundId(TWO_ROUNDS, new Set([FIRST_INTERVIEW_ROUND_ID]))).toBe("iv2");
    expect(nextInterviewRoundId(TWO_ROUNDS, new Set([FIRST_INTERVIEW_ROUND_ID, "iv2"]))).toBe("iv2");
    expect(nextInterviewRoundId(defaultTimeline({ firstDelib: false, interviews: false }), new Set())).toBe(
      FIRST_INTERVIEW_ROUND_ID,
    );
  });

  it("groups interviews by round in timeline order, skipping rounds with none", () => {
    const items = [
      { id: "b", interviewRoundId: "iv2" },
      { id: "a", interviewRoundId: FIRST_INTERVIEW_ROUND_ID },
      { id: "c", interviewRoundId: "iv2" },
    ];
    expect(groupByInterviewRound(TWO_ROUNDS, items)).toEqual([
      { roundId: FIRST_INTERVIEW_ROUND_ID, label: "Interviews", items: [items[1]] },
      { roundId: "iv2", label: "Interviews 2", items: [items[0], items[2]] },
    ]);
    expect(groupByInterviewRound(TWO_ROUNDS, [items[0]]).map((g) => g.roundId)).toEqual(["iv2"]);
  });

  it("keeps interviews from a round that left the timeline in their own group at the end", () => {
    const groups = groupByInterviewRound(STANDARD_TIMELINE, [
      { id: "x", interviewRoundId: "gone" },
      { id: "a", interviewRoundId: FIRST_INTERVIEW_ROUND_ID },
    ]);
    expect(groups.map((g) => [g.roundId, g.label])).toEqual([
      [FIRST_INTERVIEW_ROUND_ID, "Interviews"],
      ["gone", "Interviews"],
    ]);
  });

  it("keeps a later round's id and label through a save and reload", () => {
    expect(parseTimeline(JSON.parse(JSON.stringify(TWO_ROUNDS)))).toEqual(TWO_ROUNDS);
  });

  it("drops an id on a non-Interviews phase when reading", () => {
    const stored = JSON.parse(JSON.stringify(STANDARD_TIMELINE));
    stored[1].id = "x";
    expect(parseTimeline(stored)[1]).toEqual({ kind: "phase", key: "review", weeks: [6, 6] });
  });
});

describe("openTimelineChange", () => {
  const boards = new Set(["first"]);

  it("lets an open cycle add an Interviews round after its last board", () => {
    expect(openTimelineChange(STANDARD_TIMELINE, TWO_ROUNDS, boards)).toBeNull();
  });

  it("allows week and name changes with the same blocks", () => {
    const moved = STANDARD_TIMELINE.map((b) => (b.kind === "delib" ? { ...b, label: "Renamed", weeks: [8, 8] as [number, number] } : b));
    expect(openTimelineChange(STANDARD_TIMELINE, moved, boards)).toBeNull();
  });

  it("refuses removing or reordering existing blocks", () => {
    expect(openTimelineChange(TWO_ROUNDS, STANDARD_TIMELINE, boards)).toMatch(/removed/);
    const swapped = [...TWO_ROUNDS];
    [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
    expect(openTimelineChange(TWO_ROUNDS, swapped, boards)).toMatch(/reordered/);
  });

  it("refuses new blocks at or before the last round with a board", () => {
    expect(openTimelineChange(STANDARD_TIMELINE, TWO_ROUNDS, new Set(["first", "final"]))).toMatch(
      /go after final, which already has a board/,
    );
    const early: Timeline = [...base, round("x", 6), ...STANDARD_TIMELINE.slice(2)];
    expect(openTimelineChange(STANDARD_TIMELINE, early, boards)).toMatch(/go after First delib/);
  });
});
