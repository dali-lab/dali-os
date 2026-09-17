import { describe, it, expect } from "vitest";
import { educationPortalTwin } from "../portal-twin";

describe("educationPortalTwin", () => {
  it("maps the catalog root to the portal catalog", () => {
    expect(educationPortalTwin("/education")).toBe("/portal/education");
  });

  it("maps every offering browsing surface 1:1 onto its portal twin", () => {
    const cases: Array<[string, string]> = [
      ["/education/o1", "/portal/education/o1"],
      ["/education/o1/apply", "/portal/education/o1/apply"],
      ["/education/o1/hub", "/portal/education/o1/hub"],
      ["/education/o1/page/p1", "/portal/education/o1/page/p1"],
      ["/education/o1/assignments/a1", "/portal/education/o1/assignments/a1"],
    ];
    for (const [member, portal] of cases) {
      expect(educationPortalTwin(member)).toBe(portal);
    }
  });

  it("leaves external-instructor management in the shell (no twin)", () => {
    expect(educationPortalTwin("/education/manage")).toBeNull();
    expect(educationPortalTwin("/education/manage/new")).toBeNull();
    expect(educationPortalTwin("/education/manage/o1")).toBeNull();
    expect(
      educationPortalTwin("/education/manage/assignments/a1"),
    ).toBeNull();
  });

  it("has no twin for Core-only compliance or the check-in surface", () => {
    // No /portal/education/compliance route exists, and /portal/education/:id
    // must not swallow these literal segments as an offering id.
    expect(educationPortalTwin("/education/compliance")).toBeNull();
    expect(educationPortalTwin("/education/check-in/s1")).toBeNull();
  });

  it("does not map unknown offering sub-paths onto a nonexistent portal route", () => {
    expect(educationPortalTwin("/education/o1/settings")).toBeNull();
    expect(educationPortalTwin("/education/o1/page/p1/extra")).toBeNull();
  });

  it("ignores non-education paths so the gate falls back to /portal", () => {
    expect(educationPortalTwin("/projects")).toBeNull();
    expect(educationPortalTwin("/home")).toBeNull();
    expect(educationPortalTwin("/education-something-else")).toBeNull();
  });
});
