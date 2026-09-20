import { describe, it, expect } from "vitest";
import { STANDARD_TIMELINE, defaultTimeline } from "~/hiring/lib/cycle-timeline";
import { buildPhaseTabs, defaultPhase, resolvePhaseTab } from "~/hiring/lib/cycle-phase-tabs";

const opts = { hasChallenges: true };
const termStart = new Date("2026-09-14T00:00:00Z");

describe("buildPhaseTabs", () => {
  it("makes one tab per block, rounds keyed delib:<id>", () => {
    const tabs = buildPhaseTabs(STANDARD_TIMELINE, opts, {}, null);
    expect(tabs.map((t) => t.key)).toEqual([
      "setup", "review", "delib:first", "interviews", "delib:final", "decisions",
    ]);
  });

  it("marks a round done once its hold task is", () => {
    const tabs = buildPhaseTabs(STANDARD_TIMELINE, opts, { "round:final": true }, null);
    expect(tabs.find((t) => t.key === "delib:final")?.status).toBe("done");
  });
});

describe("resolvePhaseTab", () => {
  const tabs = buildPhaseTabs(STANDARD_TIMELINE, opts, {}, null);

  it("maps older tab ids", () => {
    expect(resolvePhaseTab("overview", tabs, STANDARD_TIMELINE)).toBe("setup");
    expect(resolvePhaseTab("reviewers", tabs, STANDARD_TIMELINE)).toBe("review");
    expect(resolvePhaseTab("team", tabs, STANDARD_TIMELINE)).toBe("review");
    expect(resolvePhaseTab("interviews", tabs, STANDARD_TIMELINE)).toBe("interviews");
    expect(resolvePhaseTab("decisions", tabs, STANDARD_TIMELINE)).toBe("decisions");
    expect(resolvePhaseTab("final", tabs, STANDARD_TIMELINE)).toBe("delib:final");
  });

  it("falls back to the default tab for unknown ids or a block the cycle lacks", () => {
    expect(resolvePhaseTab("bogus", tabs, STANDARD_TIMELINE)).toBe("setup");
    const t = defaultTimeline({ firstDelib: false, interviews: false });
    expect(resolvePhaseTab("interviews", buildPhaseTabs(t, opts, {}, null), t)).toBe("setup");
  });
});

describe("defaultPhase", () => {
  it("lands on the block running now", () => {
    // Oct 21 is in week 6, which is Review's.
    const tabs = buildPhaseTabs(STANDARD_TIMELINE, opts, {}, termStart, new Date("2026-10-21T12:00:00Z"));
    expect(defaultPhase(tabs)).toBe("review");
  });

  it("without a term, lands on the first block with work left", () => {
    const done = {
      domains: true, applicationDates: true, challenges: true, applicationForm: true, rubrics: true,
      reviewers: true, interviewers: true, openApplications: true,
    };
    expect(defaultPhase(buildPhaseTabs(STANDARD_TIMELINE, opts, done, null))).toBe("review");
  });
});
