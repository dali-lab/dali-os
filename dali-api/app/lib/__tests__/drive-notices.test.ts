import { describe, expect, it } from "vitest";
import { driveNoticeMessage } from "~/lib/drive-notices";

describe("driveNoticeMessage", () => {
  it("names the message for a known key", () => {
    expect(driveNoticeMessage("form-view-only")).toMatch(/not edit/);
    expect(driveNoticeMessage("form-no-access")).toMatch(/access/);
  });

  it("ignores anything else", () => {
    expect(driveNoticeMessage(null)).toBeNull();
    expect(driveNoticeMessage("constructor")).toBeNull();
    expect(driveNoticeMessage("made-up")).toBeNull();
  });
});
