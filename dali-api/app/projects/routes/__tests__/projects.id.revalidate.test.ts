import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { shouldRevalidate } from "~/projects/routes/projects.$id";

const url = (search: string, path = "/projects/p1") => new URL(`https://dali.test${path}${search}`);

function check(args: {
  current: string;
  next: string;
  formMethod?: string;
  nextPath?: string;
  defaultShouldRevalidate?: boolean;
}) {
  return shouldRevalidate({
    currentUrl: url(args.current),
    nextUrl: url(args.next, args.nextPath),
    formMethod: args.formMethod,
    defaultShouldRevalidate: args.defaultShouldRevalidate ?? true,
  } as Parameters<typeof shouldRevalidate>[0]);
}

describe("project page shouldRevalidate", () => {
  it("skips when switching between tabs that are loaded up front", () => {
    expect(check({ current: "?tab=overview", next: "?tab=board" })).toBe(false);
  });

  it("re-runs when entering the meetings tab", () => {
    expect(check({ current: "?tab=board", next: "?tab=meetings" })).toBe(true);
    expect(check({ current: "", next: "?tab=meetings" })).toBe(true);
  });

  it("skips when leaving the meetings tab", () => {
    expect(check({ current: "?tab=meetings", next: "?tab=overview" })).toBe(false);
  });

  it("re-runs when the month changes on the meetings tab", () => {
    expect(check({ current: "?tab=meetings&month=1", next: "?tab=meetings&month=2" })).toBe(true);
  });

  it("skips a month change on another tab", () => {
    expect(check({ current: "?tab=board&month=1", next: "?tab=board&month=2" })).toBe(false);
  });

  it("skips opening a task", () => {
    expect(check({ current: "?tab=board", next: "?tab=board&task=t1" })).toBe(false);
    expect(check({ current: "?tab=meetings", next: "?tab=meetings&task=t1" })).toBe(false);
  });

  it("uses the default for an unchanged URL (explicit revalidate)", () => {
    expect(check({ current: "?tab=board", next: "?tab=board" })).toBe(true);
    expect(check({ current: "?tab=board", next: "?tab=board", defaultShouldRevalidate: false })).toBe(false);
  });

  it("uses the default for a path change", () => {
    expect(check({ current: "?tab=board", next: "?tab=meetings", nextPath: "/projects/p2" })).toBe(true);
    expect(
      check({ current: "?tab=board", next: "?tab=board", nextPath: "/projects/p2", defaultShouldRevalidate: false }),
    ).toBe(false);
  });

  it("uses the default for a form submission", () => {
    expect(check({ current: "?tab=board", next: "?tab=overview", formMethod: "POST" })).toBe(true);
    expect(
      check({ current: "?tab=board", next: "?tab=overview", formMethod: "POST", defaultShouldRevalidate: false }),
    ).toBe(false);
  });
});
