import { describe, it, expect } from "vitest";
import {
  isFeedbackScreenshotKey,
  newFeedbackScreenshotKey,
} from "../feedback";

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
