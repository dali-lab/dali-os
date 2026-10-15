import { describe, expect, it } from "vitest";
import { domainTermForms, emptyDomainTermForms, isTermFormRole, latestPerUser } from "../term-forms";

describe("isTermFormRole", () => {
  it("accepts the two sides of a pairing only", () => {
    expect(isTermFormRole("mentee")).toBe(true);
    expect(isTermFormRole("mentor")).toBe(true);
    expect(isTermFormRole("Mentor")).toBe(false);
    expect(isTermFormRole(null)).toBe(false);
  });
});

describe("latestPerUser", () => {
  it("keeps each person's first (newest) submission and drops anonymous ones", () => {
    const rows = [
      { id: "a2", userId: "a" },
      { id: "anon", userId: null },
      { id: "b1", userId: "b" },
      { id: "a1", userId: "a" },
    ];
    expect(latestPerUser(rows).map((r) => r.id)).toEqual(["a2", "b1"]);
  });
});

describe("emptyDomainTermForms", () => {
  it("returns fresh objects each call", () => {
    const a = emptyDomainTermForms();
    a.mentee.responses.x = { submittedAt: "", rows: [] };
    expect(emptyDomainTermForms().mentee.responses).toEqual({});
  });
});

describe("domainTermForms", () => {
  it("returns the domain's own forms, or none for a domain without links", () => {
    const design = emptyDomainTermForms();
    design.mentor.form = { id: "f1", name: "Design mentor" };
    const forms = { design };
    expect(domainTermForms(forms, "design").mentor.form?.name).toBe("Design mentor");
    expect(domainTermForms(forms, "dev").mentor.form).toBeNull();
    expect(domainTermForms(forms, "dev").mentee.form).toBeNull();
  });
});
