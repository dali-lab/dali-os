import { describe, it, expect } from "vitest";
import { joinNames, submittedEditBanner, trackerTopLevelStage } from "~/hiring/lib/tracker-stage";

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

describe("submittedEditBanner", () => {
  const submitted = {
    cycleStatus: "Open" as string | null,
    applicationStatus: "Submitted" as string | null,
    hasOpenSelectedDomain: false,
    addableDomainNames: [] as string[],
  };

  it("offers Edit Application while one of the applicant's own domains is open", () => {
    expect(submittedEditBanner({ ...submitted, hasOpenSelectedDomain: true, addableDomainNames: ["Engineering"] })).toEqual({
      message: "The cycle is still open. You can still update your application.",
      cta: "Edit Application",
    });
  });

  it("names the one open domain they could add when all of theirs have closed", () => {
    expect(submittedEditBanner({ ...submitted, addableDomainNames: ["Engineering"] })).toEqual({
      message: "Engineering is still open. You can add it to your application.",
      cta: "Add Engineering",
    });
  });

  it("names several open domains with a plural verb and a generic button", () => {
    expect(submittedEditBanner({ ...submitted, addableDomainNames: ["Engineering", "Product Management"] })).toEqual({
      message: "Engineering and Product Management are still open. You can add them to your application.",
      cta: "Add a domain",
    });
  });

  it("is null when nothing they could edit or add is open", () => {
    expect(submittedEditBanner(submitted)).toBeNull();
  });

  it.each(["UnderReview", "Completed", null])("is null when the cycle is %s", (cycleStatus) => {
    expect(submittedEditBanner({ ...submitted, cycleStatus, hasOpenSelectedDomain: true })).toBeNull();
  });

  it.each(["Draft", "Withdrawn", null])("is null for a %s application", (applicationStatus) => {
    expect(submittedEditBanner({ ...submitted, applicationStatus, hasOpenSelectedDomain: true })).toBeNull();
  });
});

describe("joinNames", () => {
  it("joins zero, one, two, and three names", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B, and C");
  });
});
