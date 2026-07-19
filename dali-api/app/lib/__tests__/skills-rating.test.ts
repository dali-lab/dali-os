import { describe, it, expect } from "vitest";
import {
  SKILLS_RATING_UNRATED,
  isSkillsRatingComplete,
  parseSkillsRating,
} from "../skills-rating";

describe("parseSkillsRating", () => {
  it("returns an empty map for empty/missing input", () => {
    expect(parseSkillsRating("")).toEqual({});
    expect(parseSkillsRating(undefined)).toEqual({});
    expect(parseSkillsRating(null)).toEqual({});
  });

  it("parses a serialized 'skill: rating' string", () => {
    const v = "React: 3\nTypeScript: -\nGo: 0";
    expect(parseSkillsRating(v)).toEqual({
      React: "3",
      TypeScript: SKILLS_RATING_UNRATED,
      Go: "0",
    });
  });
});

describe("isSkillsRatingComplete", () => {
  const skills = ["React", "TypeScript"];

  it("is true when there are no skills", () => {
    expect(isSkillsRatingComplete("", [])).toBe(true);
  });

  it("is false on an empty answer string", () => {
    expect(isSkillsRatingComplete("", skills)).toBe(false);
  });

  it("is false when every skill is the unrated sentinel", () => {
    expect(isSkillsRatingComplete("React: -\nTypeScript: -", skills)).toBe(false);
  });

  it("is false when any skill is still the unrated sentinel", () => {
    expect(isSkillsRatingComplete("React: 4\nTypeScript: -", skills)).toBe(false);
  });

  it("is false when a rating is non-numeric or out of range", () => {
    expect(isSkillsRatingComplete("React: 6\nTypeScript: 2", skills)).toBe(false);
    expect(isSkillsRatingComplete("React: x\nTypeScript: 2", skills)).toBe(false);
  });

  it("is true when every skill has a 0–5 rating", () => {
    expect(isSkillsRatingComplete("React: 0\nTypeScript: 5", skills)).toBe(true);
    expect(isSkillsRatingComplete("React: 3\nTypeScript: 4", skills)).toBe(true);
  });

  it("is false when a skill is missing from the serialized answer", () => {
    expect(isSkillsRatingComplete("React: 3", skills)).toBe(false);
  });
});
