import { describe, it, expect } from "vitest";
import { trackerTopLevelStage } from "~/hiring/lib/tracker-stage";

const base = {
  applicationStatus: null as string | null,
  domainApplicationCount: 0,
  hasApplication: false,
  allDomainsClosed: false,
  cycleStatus: "Open" as string | null,
};

describe("trackerTopLevelStage", () => {
  it("offers Continue on a draft while the cycle is Open", () => {
    expect(
      trackerTopLevelStage({ ...base, applicationStatus: "Draft", domainApplicationCount: 1, hasApplication: true }),
    ).toBe("Draft");
  });

  it.each(["UnderReview", "Completed"])("shows Applications Closed for a draft in a %s cycle", (cycleStatus) => {
    expect(
      trackerTopLevelStage({
        ...base,
        applicationStatus: "Draft",
        domainApplicationCount: 2,
        hasApplication: true,
        cycleStatus,
      }),
    ).toBe("ApplicationsClosed");
  });

  it("is Withdrawn whatever the cycle or domain state", () => {
    expect(
      trackerTopLevelStage({
        ...base,
        applicationStatus: "Withdrawn",
        domainApplicationCount: 3,
        hasApplication: true,
        cycleStatus: "Completed",
      }),
    ).toBe("Withdrawn");
  });

  it("is Pending for a submitted application with no domain rows", () => {
    expect(trackerTopLevelStage({ ...base, applicationStatus: "Submitted", hasApplication: true })).toBe("Pending");
  });

  it("offers Apply with no application while any domain is open", () => {
    expect(trackerTopLevelStage(base)).toBe("ApplicationOpen");
  });

  it("shows Applications Closed with no application once every domain has closed", () => {
    expect(trackerTopLevelStage({ ...base, allDomainsClosed: true })).toBe("ApplicationsClosed");
  });

  it("leaves a submitted application with domain rows to the per-domain cards", () => {
    expect(
      trackerTopLevelStage({ ...base, applicationStatus: "Submitted", domainApplicationCount: 1, hasApplication: true }),
    ).toBeNull();
  });

  it("leaves a draft with no domain rows to the page (no top-level view)", () => {
    expect(trackerTopLevelStage({ ...base, applicationStatus: "Draft", hasApplication: true })).toBeNull();
  });
});
