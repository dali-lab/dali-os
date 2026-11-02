import { describe, it, expect, vi } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";

vi.mock("~/lib/db.server");

import { shouldRevalidate } from "~/education/routes/education.manage.$offeringId";

const args = (current: string, next: string, formMethod?: string) =>
  ({
    currentUrl: new URL(`https://dali.test/education/manage/o1${current}`),
    nextUrl: new URL(`https://dali.test/education/manage/o1${next}`),
    formMethod,
    defaultShouldRevalidate: true,
  }) as ShouldRevalidateFunctionArgs;

describe("education manage shouldRevalidate", () => {
  it("skips tab switches that leave the roster session alone", () => {
    expect(shouldRevalidate(args("", "?tab=roster"))).toBe(false);
    expect(shouldRevalidate(args("?tab=roster", "?tab=details"))).toBe(false);
  });
  it("revalidates when the roster session changes or is dropped", () => {
    expect(shouldRevalidate(args("?tab=roster", "?tab=roster&session=s2"))).toBe(true);
    expect(shouldRevalidate(args("?tab=roster&session=s2", "?tab=details"))).toBe(true);
  });
  it("revalidates after a mutation", () => {
    expect(shouldRevalidate(args("?tab=roster", "?tab=details", "POST"))).toBe(true);
  });
});
