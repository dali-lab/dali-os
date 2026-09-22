import { describe, it, expect } from "vitest";
import { isGuestEmail, normalizeGuestEmails, MAX_GUEST_EMAILS } from "~/calendar/lib/guest-emails";

describe("isGuestEmail", () => {
  it("accepts people and shared calendar addresses", () => {
    expect(isGuestEmail("partner@example.com")).toBe(true);
    expect(isGuestEmail("c_abc123@group.calendar.google.com")).toBe(true);
  });

  it("rejects partial input", () => {
    expect(isGuestEmail("partner")).toBe(false);
    expect(isGuestEmail("partner@example")).toBe(false);
    expect(isGuestEmail("a b@example.com")).toBe(false);
  });
});

describe("normalizeGuestEmails", () => {
  it("lowercases, dedupes, and drops invalid entries", () => {
    expect(normalizeGuestEmails([" Partner@Example.com", "partner@example.com", "nope"])).toEqual([
      "partner@example.com",
    ]);
  });

  it("skips addresses already on the invite as members", () => {
    expect(
      normalizeGuestEmails(["ally@dali.dartmouth.edu", "x@example.com"], ["Ally@dali.dartmouth.edu"]),
    ).toEqual(["x@example.com"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_GUEST_EMAILS + 5 }, (_, i) => `g${i}@example.com`);
    expect(normalizeGuestEmails(many)).toHaveLength(MAX_GUEST_EMAILS);
  });
});
