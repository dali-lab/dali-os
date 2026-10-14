import { describe, expect, it } from "vitest";
import { emptyTermForms, isTermFormRole, latestPerUser } from "../term-forms";

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

describe("emptyTermForms", () => {
  it("returns fresh objects each call", () => {
    const a = emptyTermForms();
    a.mentee.responses.x = { submittedAt: "", rows: [] };
    expect(emptyTermForms().mentee.responses).toEqual({});
  });
});
