import { describe, it, expect } from "vitest";
import { initialsFromName, userInitials, termCodeLabel, formatMonthDayTime, primaryEmail, displayEmail } from "~/lib/display";

describe("initialsFromName", () => {
  it("returns first + last initial for a full name", () => {
    expect(initialsFromName("Jane Smith")).toBe("JS");
  });

  it("returns first two letters for a single-word name", () => {
    expect(initialsFromName("Jane")).toBe("JA");
  });

  it("ignores extra whitespace between and around words", () => {
    expect(initialsFromName("  Ada   Lovelace  ")).toBe("AL");
  });

  it("uses first and last word for names with many parts", () => {
    expect(initialsFromName("Mary Anne Jones")).toBe("MJ");
  });

  it("returns ? for an empty string", () => {
    expect(initialsFromName("")).toBe("?");
  });

  it("returns ? for whitespace-only string", () => {
    expect(initialsFromName("   ")).toBe("?");
  });
});

describe("userInitials", () => {
  it("uses first and last name when both are present", () => {
    expect(userInitials({ firstName: "Jane", lastName: "Smith", email: "j@x.com" })).toBe("JS");
  });

  it("uses firstName alone when lastName is absent", () => {
    expect(userInitials({ firstName: "Alice", email: "alice@example.com" })).toBe("AL");
  });

  it("falls back to email local-part when no name fields", () => {
    expect(userInitials({ email: "jsmith@dartmouth.edu" })).toBe("JS");
  });

  it("handles short email local-parts gracefully", () => {
    expect(userInitials({ email: "a@x.com" })).toBe("A");
  });
});

describe("termCodeLabel", () => {
  it("spells out each season", () => {
    expect(termCodeLabel("26W")).toBe("Winter 2026");
    expect(termCodeLabel("26S")).toBe("Spring 2026");
    expect(termCodeLabel("26X")).toBe("Summer 2026");
    expect(termCodeLabel("27F")).toBe("Fall 2027");
  });

  it("passes unrecognized codes through unchanged", () => {
    expect(termCodeLabel("spring")).toBe("spring");
    expect(termCodeLabel("2026S")).toBe("2026S");
    expect(termCodeLabel("")).toBe("");
  });
});

describe("formatMonthDayTime", () => {
  const instant = "2026-11-12T19:00:00Z";

  it("renders the same string wherever the host runs, using the given zone", () => {
    expect(formatMonthDayTime(instant, "UTC")).toBe("Nov 12, 7:00 PM");
    expect(formatMonthDayTime(instant, "America/New_York")).toBe("Nov 12, 2:00 PM");
  });

  it("defaults to the lab zone", () => {
    expect(formatMonthDayTime(instant)).toBe("Nov 12, 2:00 PM");
  });

  it("shows a dash for a missing instant", () => {
    expect(formatMonthDayTime(null)).toBe("—");
    expect(formatMonthDayTime(undefined, "UTC")).toBe("—");
  });

  it("crosses the date line in the given zone", () => {
    expect(formatMonthDayTime("2026-11-13T02:30:00Z", "America/New_York")).toBe("Nov 12, 9:30 PM");
  });
});

describe("primaryEmail and displayEmail", () => {
  const row = { daliEmail: "ada@dali.dartmouth.edu", dartmouthEmail: "ada@dartmouth.edu", personalEmail: "ada@example.com", netId: "f00abc" };

  it("puts the chosen login email first", () => {
    expect(primaryEmail({ ...row, email: "me@example.com" })).toBe("me@example.com");
    expect(displayEmail({ ...row, email: "me@example.com" })).toBe("me@example.com");
  });

  it("keeps the old order when there is no login email", () => {
    expect(primaryEmail(row)).toBe("ada@dali.dartmouth.edu");
    expect(primaryEmail({ ...row, email: null, daliEmail: null })).toBe("ada@dartmouth.edu");
    expect(displayEmail({ ...row, daliEmail: null, dartmouthEmail: null, personalEmail: null })).toBe("f00abc@dartmouth.edu");
    expect(primaryEmail({})).toBeNull();
  });
});
