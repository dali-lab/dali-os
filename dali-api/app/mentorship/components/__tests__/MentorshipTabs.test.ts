import { describe, expect, it } from "vitest";
import { mentorshipTabs } from "../MentorshipTabs";

describe("mentorshipTabs", () => {
  it("links Notes and Warnings", () => {
    expect(mentorshipTabs("/mentorship/browse").map((t) => [t.label, t.href])).toEqual([
      ["Notes", "/mentorship/browse"],
      ["Warnings", "/mentorship/warnings"],
    ]);
  });

  it("marks the open tab", () => {
    expect(mentorshipTabs("/mentorship/warnings").map((t) => t.active)).toEqual([false, true]);
    expect(mentorshipTabs("/mentorship/browse").map((t) => t.active)).toEqual([true, false]);
  });
});
