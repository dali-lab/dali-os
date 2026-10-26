import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db");

import { shouldRevalidate } from "~/projects/routes/projects.hub";

const url = (search: string, path = "/projects") => new URL(`https://dali.test${path}${search}`);

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

describe("projects hub shouldRevalidate", () => {
  it("skips client-only param changes", () => {
    expect(check({ current: "", next: "?public=Published" })).toBe(false);
    expect(check({ current: "?public=Published", next: "?public=Published&new=tpl1" })).toBe(false);
  });

  it("re-runs when the term changes", () => {
    expect(check({ current: "?term=a", next: "?term=b" })).toBe(true);
    expect(check({ current: "", next: "?term=b" })).toBe(true);
    expect(check({ current: "?term=a", next: "" })).toBe(true);
  });

  it("skips a client-only change while a term is set", () => {
    expect(check({ current: "?term=a", next: "?term=a&public=none" })).toBe(false);
  });

  it("uses the default for an unchanged URL", () => {
    expect(check({ current: "?term=a", next: "?term=a" })).toBe(true);
    expect(check({ current: "?term=a", next: "?term=a", defaultShouldRevalidate: false })).toBe(false);
  });

  it("uses the default for a path change", () => {
    expect(check({ current: "", next: "?public=x", nextPath: "/other", defaultShouldRevalidate: false })).toBe(false);
    expect(check({ current: "", next: "?public=x", nextPath: "/other" })).toBe(true);
  });

  it("uses the default for a form submission", () => {
    expect(check({ current: "", next: "?public=x", formMethod: "POST" })).toBe(true);
    expect(check({ current: "", next: "?public=x", formMethod: "POST", defaultShouldRevalidate: false })).toBe(false);
  });
});
