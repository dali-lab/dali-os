import { describe, it, expect } from "vitest";
import { OPEN_TO_CHOICES, openToPatch, parseJsonList } from "../open-to";

describe("open-to choices", () => {
  it("lists the five designed tiles in order", () => {
    expect(OPEN_TO_CHOICES.map((c) => c.title)).toEqual([
      "Coffee chats",
      "Resume reviews",
      "Partner referrals",
      "Mentor a project",
      "Speak at a lab event",
    ]);
  });
});

describe("parseJsonList", () => {
  it("parses the topic list and drops anything that is not a string list", () => {
    expect(parseJsonList('["a","b",3]')).toEqual(["a", "b"]);
    expect(parseJsonList("nope")).toEqual([]);
    expect(parseJsonList('{"a":1}')).toEqual([]);
  });
});

describe("openToPatch", () => {
  const choices = { coffeeChats: true, resumeReviews: true, partnerReferrals: false, mentoring: false, speaking: true };

  it("sets both the resume and portfolio columns from the one resume tile", () => {
    expect(openToPatch(choices)).toEqual({
      coffeeChats: true,
      resumeReviews: true,
      portfolioReviews: true,
      partnerReferrals: false,
      mentoring: false,
      speaking: true,
    });
    expect(openToPatch({ ...choices, resumeReviews: false })).toMatchObject({
      resumeReviews: false,
      portfolioReviews: false,
    });
  });
});
