import { describe, it, expect } from "vitest";
import {
  isFeedbackScreenshotKey,
  newFeedbackScreenshotKey,
  summarizeReactions,
} from "../feedback";

describe("summarizeReactions", () => {
  it("counts per emoji in picker order and marks the viewer's own", () => {
    const rows = [
      { emoji: "🚀", userId: "a" },
      { emoji: "👍", userId: "b" },
      { emoji: "👍", userId: "me" },
    ];
    expect(summarizeReactions(rows, "me")).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🚀", count: 1, mine: false },
    ]);
  });

  it("returns nothing for a post without reactions", () => {
    expect(summarizeReactions([], "me")).toEqual([]);
  });
});

describe("isFeedbackScreenshotKey", () => {
  it("accepts the key the composer mints, once the presign route scopes it", () => {
    expect(isFeedbackScreenshotKey(`uploads/${newFeedbackScreenshotKey()}`)).toBe(true);
  });

  it("rejects keys from anywhere else", () => {
    expect(isFeedbackScreenshotKey("uploads/avatars/u1/x.png")).toBe(false);
    expect(isFeedbackScreenshotKey("uploads/feedback/../payroll-imports/x.png")).toBe(false);
    expect(isFeedbackScreenshotKey("https://example.com/a.png")).toBe(false);
  });
});
