import { describe, it, expect, beforeEach, vi } from "vitest";

// Unit tests for {{menteeName}} resolution in resolveSigningVariablesForSigner.
// Prisma and currentTerm are mocked so the role-aware counterpart lookup + the
// natural-language name join are exercised in isolation. termCode is always
// passed so the currentTerm() branch is skipped.

const h = vi.hoisted(() => ({
  user: { firstName: "Morgan", lastName: "Mentor" } as
    | null
    | { firstName: string; lastName: string },
  mentees: [] as { mentee: { firstName: string; lastName: string } }[],
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => h.user) },
    mentorshipPair: { findMany: vi.fn(async () => h.mentees) },
  },
}));

vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(async () => null) }));

import { resolveSigningVariablesForSigner } from "../variables.server";

describe("resolveSigningVariablesForSigner — menteeName", () => {
  beforeEach(() => {
    h.user = { firstName: "Morgan", lastName: "Mentor" };
    h.mentees = [];
  });

  it("leaves menteeName empty with no bound term", async () => {
    const v = await resolveSigningVariablesForSigner("u-mentor", {
      termCode: "26F",
      role: "member",
    });
    expect(v.menteeName).toBe("");
  });

  it("names the two mentees a mentor mentors this term", async () => {
    h.mentees = [
      { mentee: { firstName: "Alex", lastName: "One" } },
      { mentee: { firstName: "Blair", lastName: "Two" } },
    ];
    const v = await resolveSigningVariablesForSigner("u-mentor", {
      termCode: "26F",
      role: "member",
      termId: "t1",
    });
    expect(v.menteeName).toBe("Alex One and Blair Two");
    expect(v.memberName).toBe("Morgan Mentor");
  });

  it("uses an Oxford join for three or more mentees", async () => {
    h.mentees = [
      { mentee: { firstName: "Alex", lastName: "One" } },
      { mentee: { firstName: "Blair", lastName: "Two" } },
      { mentee: { firstName: "Casey", lastName: "Three" } },
    ];
    const v = await resolveSigningVariablesForSigner("u-mentor", {
      termCode: "26F",
      role: "member",
      termId: "t1",
    });
    expect(v.menteeName).toBe("Alex One, Blair Two, and Casey Three");
  });

  it("resolves menteeName to the signer on a mentee's own copy", async () => {
    h.user = { firstName: "Sam", lastName: "Mentee" };
    const v = await resolveSigningVariablesForSigner("u-mentee", {
      termCode: "26F",
      role: "mentee",
      termId: "t1",
    });
    expect(v.menteeName).toBe("Sam Mentee");
  });
});
