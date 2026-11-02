import { describe, it, expect, vi } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";

vi.mock("~/lib/db.server");

import { shouldRevalidate as leadCycle } from "~/hiring/routes/lead.cycle.$id";
import { shouldRevalidate as domainLead } from "~/hiring/routes/domain-lead";

const args = (current: string, next: string, formMethod?: string) =>
  ({
    currentUrl: new URL(`https://dali.test/p${current}`),
    nextUrl: new URL(`https://dali.test/p${next}`),
    formMethod,
    defaultShouldRevalidate: true,
  }) as ShouldRevalidateFunctionArgs;

describe("lead cycle shouldRevalidate", () => {
  it("skips tab changes", () => {
    expect(leadCycle(args("?tab=setup", "?tab=delib:r1"))).toBe(false);
  });
  it("revalidates after a mutation or an identical URL", () => {
    expect(leadCycle(args("?tab=setup", "?tab=setup", "POST"))).toBe(true);
    expect(leadCycle(args("?tab=setup", "?tab=setup"))).toBe(true);
  });
});

describe("domain lead shouldRevalidate", () => {
  it("skips client-only params", () => {
    expect(domainLead(args("", "?domain=d1"))).toBe(false);
    expect(domainLead(args("?domain=d1", "?domain=d1&q=ada&sort=name&dir=desc&app_filter=finalize"))).toBe(false);
  });
  it("revalidates when ?cycle= changes", () => {
    expect(domainLead(args("", "?cycle=c1"))).toBe(true);
    expect(domainLead(args("?cycle=c1&domain=d1", "?cycle=c2&domain=d1"))).toBe(true);
  });
  it("revalidates after a mutation", () => {
    expect(domainLead(args("?domain=d1", "?domain=d2", "POST"))).toBe(true);
  });
});
