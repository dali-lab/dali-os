import { describe, it, expect } from "vitest";
import { blockDates, defaultApplicationWindow, phaseStatus, tasksForBlock, termWeek } from "~/hiring/lib/cycle-phases";
import { STANDARD_TIMELINE, defaultTimeline, type Timeline } from "~/hiring/lib/cycle-timeline";

const termStart = new Date("2026-09-14T00:00:00Z"); // a Monday
const day = (n: number) => new Date(termStart.getTime() + n * 24 * 60 * 60 * 1000);
const keysOf = (t: Timeline, i: number, hasChallenges = true) =>
  tasksForBlock(t, t[i], { hasChallenges }).map((x) => x.key);

describe("blockDates", () => {
  it("runs weeks 1 to 4 from the term start through the end of week 4", () => {
    expect(blockDates(termStart, [1, 4])).toEqual({ start: day(0), end: day(28) });
  });

  it("puts week 9 in the ninth week", () => {
    expect(blockDates(termStart, [9, 9])).toEqual({ start: day(56), end: day(63) });
  });
});

describe("termWeek", () => {
  it("counts from 1 on the term's first day", () => {
    expect(termWeek(termStart, day(0))).toBe(1);
    expect(termWeek(termStart, day(7))).toBe(2);
    expect(termWeek(termStart, day(-1))).toBe(0);
  });
});

describe("defaultApplicationWindow", () => {
  it("opens as week 4 starts and closes on the last day of week 5", () => {
    expect(defaultApplicationWindow(termStart)).toEqual({ open: day(21), closeDay: day(34) });
  });
});

describe("tasksForBlock", () => {
  // Standard: setup, review, First delib, interviews, Final delib, decisions.
  it("gives each delib round a hold task, and invites to the one before Interviews", () => {
    expect(keysOf(STANDARD_TIMELINE, 2)).toEqual(["round:first", "interviewInvites"]);
    expect(keysOf(STANDARD_TIMELINE, 4)).toEqual(["round:final"]);
  });

  it("puts the interview schedule and interviews on the Interviews phase", () => {
    expect(keysOf(STANDARD_TIMELINE, 3)).toEqual(["interviewSchedule", "conductInterviews"]);
  });

  it("opens applications on Setup and puts the review team on Review", () => {
    expect(keysOf(STANDARD_TIMELINE, 0)).toContain("openApplications");
    expect(keysOf(STANDARD_TIMELINE, 0)).not.toContain("reviewers");
    expect(keysOf(STANDARD_TIMELINE, 1)).toEqual(expect.arrayContaining(["reviewers", "interviewers", "reviews"]));
  });

  it("drops interview and challenge tasks a cycle doesn't have", () => {
    const noInterviews = defaultTimeline({ firstDelib: false, interviews: false });
    expect(keysOf(noInterviews, 1)).not.toContain("interviewers");
    expect(keysOf(noInterviews, 0, false)).not.toContain("challenges");
  });
});

describe("phaseStatus", () => {
  const dates = { start: day(7), end: day(14) };

  it("is done once every task is, whatever the date", () => {
    expect(phaseStatus([true, true], dates, day(30))).toBe("done");
  });

  it("is current inside its weeks, overdue after them, upcoming before", () => {
    expect(phaseStatus([false], dates, day(8))).toBe("current");
    expect(phaseStatus([false], dates, day(20))).toBe("overdue");
    expect(phaseStatus([false], dates, day(1))).toBe("upcoming");
  });

  it("never reads as overdue without a term to date it", () => {
    expect(phaseStatus([false], null, day(100))).toBe("upcoming");
  });
});
