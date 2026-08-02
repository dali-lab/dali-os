import { describe, it, expect } from "vitest";
import {
  matchScore,
  bestScore,
  rankResults,
  buildUrl,
  computeHiringVisibility,
  PER_CATEGORY_CAP,
  type Rankable,
} from "~/lib/search";

describe("matchScore", () => {
  it("ranks exact > prefix > word-start > substring", () => {
    expect(matchScore("Alex", "alex")).toBe(0);
    expect(matchScore("Alexander", "alex")).toBe(1);
    expect(matchScore("Jordan Alexander", "alex")).toBe(2);
    expect(matchScore("Malex", "alex")).toBe(3);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchScore("  PROJECT Zero ", "project")).toBe(1);
  });

  it("returns null for no match or empty query", () => {
    expect(matchScore("Alex", "bob")).toBeNull();
    expect(matchScore("Alex", "")).toBeNull();
    expect(matchScore("", "alex")).toBeNull();
  });
});

describe("bestScore", () => {
  it("takes the best score across fields (e.g. name vs email)", () => {
    // name is a substring match (3), email is a prefix match (1) → best is 1.
    expect(bestScore(["Sam Malex", "alex@dali.dev"], "alex")).toBe(1);
  });

  it("returns null when no field matches", () => {
    expect(bestScore(["Sam", "sam@dali.dev"], "zzz")).toBeNull();
  });
});

describe("rankResults", () => {
  const mk = (title: string): Rankable => ({
    result: { type: "project", id: title, title, url: buildUrl.project(title) },
    text: [title],
  });

  it("orders by score then alphabetically, dropping non-matches", () => {
    const out = rankResults([mk("Zeta Query"), mk("Query"), mk("Query Tools"), mk("Nope")], "query");
    expect(out.map((r) => r.title)).toEqual(["Query", "Query Tools", "Zeta Query"]);
  });

  it("caps each category at PER_CATEGORY_CAP", () => {
    const many = Array.from({ length: PER_CATEGORY_CAP + 3 }, (_, i) => mk(`Query ${i}`));
    expect(rankResults(many, "query")).toHaveLength(PER_CATEGORY_CAP);
  });
});

describe("buildUrl (route-param gotchas)", () => {
  it("maps each type to its canonical detail URL", () => {
    expect(buildUrl.person("u1")).toBe("/members/u1");
    expect(buildUrl.project("p1")).toBe("/projects/p1");
    expect(buildUrl.education("o1")).toBe("/education/o1");
    expect(buildUrl.partner("g1")).toBe("/partners/g1");
    expect(buildUrl.document("d1")).toBe("/documents/d1");
    expect(buildUrl.application("da1")).toBe("/hiring/applications/da1");
    expect(buildUrl.form("f1")).toBe("/forms/edit/f1");
    expect(buildUrl.formFolder("fo1")).toBe("/forms/fo1");
    expect(buildUrl.challenge("c1")).toBe("/hiring/challenges/c1");
    expect(buildUrl.rubric("r1")).toBe("/hiring/rubrics/r1");
    expect(buildUrl.emailTemplate("e1")).toBe("/admin/email-templates/e1");
    expect(buildUrl.confidentialityAgreement("a1")).toBe("/hiring/confidentiality-agreements/a1");
    expect(buildUrl.partnerApplication("pa1")).toBe("/partners/applications/pa1");
    expect(buildUrl.cycle("cy1")).toBe("/hiring/lead/cycle/cy1");
  });
});

describe("computeHiringVisibility (leak-proofing)", () => {
  const rows = [
    { applicationCycleId: "c1", domainId: "d1" },
    { applicationCycleId: "c1", domainId: "d2" },
  ];

  it("Core sees everything", () => {
    expect(computeHiringVisibility(true, [])).toEqual({ all: true });
  });

  it("a reviewer sees only their assigned (cycle, domain) pairs", () => {
    expect(computeHiringVisibility(false, rows)).toEqual({ all: false, pairs: rows });
  });

  it("a non-Core user with no reviewer rows sees nothing", () => {
    expect(computeHiringVisibility(false, [])).toEqual({ all: false, pairs: [] });
  });
});
