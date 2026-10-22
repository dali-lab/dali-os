import { describe, expect, it } from "vitest";
import { isRangeLoading } from "~/calendar/lib/use-calendar-view";

const here = { pathname: "/calendar", search: "?view=week&anchor=2026-10-18" };

describe("isRangeLoading", () => {
  it("is true while a new window of the calendar loads", () => {
    expect(
      isRangeLoading({ state: "loading", location: { pathname: "/calendar", search: "?view=week&anchor=2026-10-25" } }, here),
    ).toBe(true);
  });

  it("is false when nothing is navigating", () => {
    expect(isRangeLoading({ state: "idle" }, here)).toBe(false);
  });

  it("is false while a form is submitting", () => {
    expect(
      isRangeLoading({ state: "submitting", location: { pathname: "/calendar", search: "?view=week&anchor=2026-10-25" } }, here),
    ).toBe(false);
  });

  it("is false for a revalidation, which keeps the current location", () => {
    expect(isRangeLoading({ state: "loading", location: { ...here } }, here)).toBe(false);
  });

  it("is false when leaving for another page", () => {
    expect(isRangeLoading({ state: "loading", location: { pathname: "/projects", search: "" } }, here)).toBe(false);
  });
});
