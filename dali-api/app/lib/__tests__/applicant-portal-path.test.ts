import { describe, it, expect } from "vitest";
import { applicantPortalPath } from "~/lib/applicant-portal-path";

describe("applicantPortalPath", () => {
  it("points each applicant group at its own apply page", () => {
    expect(applicantPortalPath("Students", "c1")).toBe("/portal/apply/c1");
    expect(applicantPortalPath("Interns", "c1")).toBe("/fellowship/c1");
    expect(applicantPortalPath("LabMembers", "c1")).toBe("/core/apply/c1");
  });
});
