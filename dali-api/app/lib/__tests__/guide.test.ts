import { describe, expect, it } from "vitest";
import {
  GUIDE_CHAPTERS,
  GUIDE_STEPS,
  GUIDE_REQUIRED_STEPS,
  guideProgress,
  isStepCleared,
  type GuideRequirements,
  type GuideStepMeta,
} from "../guide";

const NOTHING: GuideRequirements = {
  photo: false,
  timezone: false,
  calendarLink: false,
};
const EVERYTHING: GuideRequirements = {
  photo: true,
  timezone: true,
  calendarLink: true,
};

describe("guide registry", () => {
  it("has unique step ids", () => {
    const ids = GUIDE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses declared chapters", () => {
    const chapters = new Set(GUIDE_CHAPTERS.map((c) => c.key));
    for (const step of GUIDE_STEPS) expect(chapters.has(step.chapter)).toBe(true);
  });

  it("gates at least the account-setup steps", () => {
    const gated = GUIDE_REQUIRED_STEPS.map((s) => s.requires);
    expect(gated).toContain("photo");
    expect(gated).toContain("timezone");
    expect(gated).toContain("calendarLink");
  });
});

describe("isStepCleared", () => {
  const gated: GuideStepMeta = {
    id: "profile-photo",
    chapter: "setup",
    title: "Add a photo",
    summary: "",
    requires: "photo",
  };
  const plain: GuideStepMeta = {
    id: "tasks",
    chapter: "around",
    title: "My Tasks",
    summary: "",
  };

  it("clears a plain step from the stored list", () => {
    expect(isStepCleared(plain, ["tasks"], NOTHING)).toBe(true);
    expect(isStepCleared(plain, [], NOTHING)).toBe(false);
  });

  it("reads a gated step from the account, not the stored list", () => {
    // Stored as cleared but the photo is gone: the step is undone.
    expect(isStepCleared(gated, ["profile-photo"], NOTHING)).toBe(false);
    // Photo uploaded outside the guide: the step counts anyway.
    expect(isStepCleared(gated, [], EVERYTHING)).toBe(true);
  });
});

describe("guideProgress", () => {
  it("starts at zero and resumes at the first step", () => {
    const p = guideProgress([], NOTHING);
    expect(p.cleared).toBe(0);
    expect(p.total).toBe(GUIDE_STEPS.length);
    expect(p.resumeIndex).toBe(0);
    expect(p.complete).toBe(false);
  });

  it("lists only unmet gated steps as outstanding", () => {
    const p = guideProgress([], { ...NOTHING, photo: true });
    const outstanding = p.outstanding.map((s) => s.requires);
    expect(outstanding).not.toContain("photo");
    expect(outstanding).toContain("timezone");
    expect(outstanding).toContain("calendarLink");
  });

  it("resumes at the first unfinished step, skipping already-satisfied ones", () => {
    const firstTwo = GUIDE_STEPS.slice(0, 2).map((s) => s.id);
    expect(guideProgress(firstTwo, NOTHING).resumeIndex).toBe(2);
  });

  it("is complete only when every step and gate is satisfied", () => {
    const allIds = GUIDE_STEPS.map((s) => s.id);
    expect(guideProgress(allIds, NOTHING).complete).toBe(false);
    const done = guideProgress(allIds, EVERYTHING);
    expect(done.complete).toBe(true);
    expect(done.resumeIndex).toBe(GUIDE_STEPS.length);
    expect(done.outstanding).toEqual([]);
  });

  it("ignores unknown ids left over from removed steps", () => {
    expect(guideProgress(["a-step-that-no-longer-exists"], NOTHING).cleared).toBe(0);
  });
});
