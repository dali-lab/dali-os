import { describe, expect, it } from "vitest";
import { matchesBoardSearch, type MemberInput } from "./staffing-board";

function member(overrides: Partial<MemberInput> = {}): MemberInput {
  return {
    userId: "u1",
    firstName: "Ada",
    lastName: "O'Brien",
    email: "ada.obrien@dali.dartmouth.edu",
    photoUrl: null,
    isAdmin: false,
    coreTitles: [],
    preferences: [
      { projectId: "p1", domainId: "d1", level: "P2", preferenceRank: 1, notes: "Excited about the mapping UI" },
    ],
    bidFields: [
      { label: "Why this project?", value: "I love working with React and design systems." },
    ],
    domainLevels: [{ domainId: "d1", domainName: "Design", level: "P2" }],
    ...overrides,
  };
}

describe("matchesBoardSearch", () => {
  it("matches everyone on an empty / whitespace query", () => {
    expect(matchesBoardSearch(member(), "")).toBe(true);
    expect(matchesBoardSearch(member(), "   ")).toBe(true);
  });

  it("matches on name (case-insensitive)", () => {
    expect(matchesBoardSearch(member(), "ada")).toBe(true);
    expect(matchesBoardSearch(member(), "O'BRIEN")).toBe(true);
  });

  it("matches on email", () => {
    expect(matchesBoardSearch(member(), "ada.obrien@dali")).toBe(true);
  });

  it("matches on eligibility domain name", () => {
    expect(matchesBoardSearch(member(), "design")).toBe(true);
  });

  it("matches on full application text — bid answers and preference notes", () => {
    expect(matchesBoardSearch(member(), "react")).toBe(true); // bid value
    expect(matchesBoardSearch(member(), "Why this")).toBe(true); // bid label, case-insensitive
    expect(matchesBoardSearch(member(), "why this project")).toBe(true); // bid label, multi-token
    expect(matchesBoardSearch(member(), "mapping ui")).toBe(true); // preference note
  });

  it("requires ALL tokens to match (token-AND)", () => {
    expect(matchesBoardSearch(member(), "ada design")).toBe(true);
    expect(matchesBoardSearch(member(), "ada devops")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(matchesBoardSearch(member(), "zzzznope")).toBe(false);
  });

  it("tolerates missing email / empty notes", () => {
    const m = member({
      email: null,
      preferences: [{ projectId: "p1", domainId: "d1", level: "P1", preferenceRank: 1, notes: null }],
      bidFields: [],
    });
    expect(matchesBoardSearch(m, "ada")).toBe(true);
    expect(matchesBoardSearch(m, "react")).toBe(false);
  });
});
