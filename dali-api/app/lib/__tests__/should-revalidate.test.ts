import { describe, it, expect } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";

const url = (search: string, path = "/page") => new URL(`https://dali.test${path}${search}`);

function check(
  current: string,
  next: string,
  serverParams: string[],
  extra: { formMethod?: string; nextPath?: string; defaultShouldRevalidate?: boolean } = {},
) {
  return skipClientOnlySearchChange(
    {
      currentUrl: url(current),
      nextUrl: url(next, extra.nextPath),
      formMethod: extra.formMethod,
      defaultShouldRevalidate: extra.defaultShouldRevalidate ?? true,
    } as ShouldRevalidateFunctionArgs,
    serverParams,
  );
}

describe("skipClientOnlySearchChange", () => {
  it("skips a change to a client-only param", () => {
    expect(check("", "?tab=roster", ["session"])).toBe(false);
    expect(check("?tab=a&session=s1", "?tab=b&session=s1", ["session"])).toBe(false);
  });

  it("revalidates when a server-read param is added, changed or removed", () => {
    expect(check("", "?session=s1", ["session"])).toBe(true);
    expect(check("?session=s1", "?session=s2", ["session"])).toBe(true);
    expect(check("?tab=roster&session=s1", "?tab=details", ["session"])).toBe(true);
  });

  it("revalidates when a server-read param changes alongside a client-only one", () => {
    expect(check("?tab=a", "?tab=b&session=s1", ["session"])).toBe(true);
  });

  it("revalidates on non-GET submissions even when only client-only params differ", () => {
    expect(check("", "?tab=b", ["session"], { formMethod: "POST" })).toBe(true);
    expect(check("", "?tab=b", ["session"], { formMethod: "post" })).toBe(true);
  });

  it("treats an explicit GET like a plain navigation", () => {
    expect(check("", "?tab=b", ["session"], { formMethod: "GET" })).toBe(false);
  });

  it("revalidates when the query string is identical (manual revalidate)", () => {
    expect(check("?tab=a", "?tab=a", ["session"])).toBe(true);
  });

  it("revalidates on a different path", () => {
    expect(check("?tab=a", "?tab=b", ["session"], { nextPath: "/other" })).toBe(true);
  });

  it("follows defaultShouldRevalidate when deferring", () => {
    expect(check("?tab=a", "?tab=a", ["session"], { defaultShouldRevalidate: false })).toBe(false);
  });

  it("compares repeated values of a server param", () => {
    expect(check("?session=a", "?session=a&session=b", ["session"])).toBe(true);
  });
});
