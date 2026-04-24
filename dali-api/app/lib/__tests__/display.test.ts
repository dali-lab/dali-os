import { describe, it, expect } from "vitest";
import { initialsFromName, userInitials } from "~/lib/display";

describe("initialsFromName", () => {
  it("returns first + last initial for a full name", () => {
    expect(initialsFromName("Jane Smith")).toBe("JS");
  });

  it("returns first two letters for a single-word name", () => {
    expect(initialsFromName("Jane")).toBe("JA");
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
