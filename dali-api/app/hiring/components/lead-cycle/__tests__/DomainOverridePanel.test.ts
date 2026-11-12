import { describe, it, expect } from "vitest";
import { acceptPreemptionWarning } from "../DomainOverridePanel";

const decision = (type: string, siblings: { name: string; closeDate: string | null }[] | undefined) => ({
  type,
  openSiblingDomains: siblings,
  domainApplication: { application: { user: { firstName: "Ada" } } },
});

describe("acceptPreemptionWarning", () => {
  it("is null when nothing would be preempted", () => {
    expect(acceptPreemptionWarning(decision("Accepted", []))).toBeNull();
    expect(acceptPreemptionWarning(decision("Accepted", undefined))).toBeNull();
  });
  it("is null for outcomes other than Accepted", () => {
    expect(acceptPreemptionWarning(decision("Rejected", [{ name: "Web", closeDate: null }]))).toBeNull();
  });
  it("names a single sibling domain", () => {
    const w = acceptPreemptionWarning(decision("Accepted", [{ name: "Web", closeDate: null }]));
    expect(w?.title).toBe("Accept and close Web?");
    expect(w?.description).toContain("Ada can still edit their Web application.");
    expect(w?.description).toContain("closes it as placed elsewhere");
  });
  it("lists several siblings with their close dates", () => {
    const w = acceptPreemptionWarning(
      decision("Accepted", [
        { name: "Web", closeDate: "2026-02-01T12:00:00Z" },
        { name: "iOS", closeDate: null },
      ]),
    );
    expect(w?.title).toBe("Accept and close Web and iOS?");
    expect(w?.description).toContain("Web (until Feb 1)");
    expect(w?.description).toContain("closes them as placed elsewhere");
  });
});
