import { describe, expect, it } from "vitest";
import type { Question } from "~/types";
import { getDomainColor, getPickedQuestions, DOMAIN_COLORS } from "../apply-sections";

const q = (key: string): Question => ({ key, type: "text", required: true, data: { label: key } }) as Question;

const domain = {
  id: "d1",
  name: "Design",
  challenges: [
    { challengeVersionId: "form:a", challengeName: "A", description: null, questions: [q("a1")] },
    { challengeVersionId: "form:b", challengeName: "B", description: null, questions: [q("b1"), q("b2")] },
  ],
};

describe("getPickedQuestions", () => {
  it("returns the questions of the picked challenge", () => {
    expect(getPickedQuestions(domain, "form:b").map((x) => x.key)).toEqual(["b1", "b2"]);
  });

  it("returns nothing when no challenge is picked or the pick is unknown", () => {
    expect(getPickedQuestions(domain, null)).toEqual([]);
    expect(getPickedQuestions(domain, undefined)).toEqual([]);
    expect(getPickedQuestions(domain, "form:zzz")).toEqual([]);
  });
});

describe("getDomainColor", () => {
  it("cycles through the palette", () => {
    expect(getDomainColor(0)).toBe(DOMAIN_COLORS[0]);
    expect(getDomainColor(DOMAIN_COLORS.length)).toBe(DOMAIN_COLORS[0]);
    expect(getDomainColor(DOMAIN_COLORS.length + 1)).toBe(DOMAIN_COLORS[1]);
  });
});
