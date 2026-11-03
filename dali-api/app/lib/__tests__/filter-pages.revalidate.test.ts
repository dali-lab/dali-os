import { describe, expect, it, vi } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";

vi.mock("~/lib/db.server");

import * as partnersBoard from "~/partners/routes/core.partners";
import * as partnersDirectory from "~/partners/routes/core.partners.directory";
import * as partnersReferrals from "~/partners/routes/core.partners.referrals";
import * as members from "~/members/routes/members";
import * as mentorship from "~/mentorship/routes/mentorship.browse";

type ShouldRevalidate = (args: ShouldRevalidateFunctionArgs) => boolean;

const PAGES: {
  name: string;
  path: string;
  shouldRevalidate: ShouldRevalidate;
  loaderParams: string[];
}[] = [
  { name: "Partners board", path: "/core/partners", shouldRevalidate: partnersBoard.shouldRevalidate, loaderParams: [] },
  { name: "Partners directory", path: "/core/partners/directory", shouldRevalidate: partnersDirectory.shouldRevalidate, loaderParams: [] },
  { name: "Referrals", path: "/core/partners/referrals", shouldRevalidate: partnersReferrals.shouldRevalidate, loaderParams: ["term"] },
  { name: "Members", path: "/members", shouldRevalidate: members.shouldRevalidate, loaderParams: ["status", "domain", "project", "class"] },
  {
    name: "Mentorship browse",
    path: "/mentorship/browse",
    shouldRevalidate: mentorship.shouldRevalidate,
    loaderParams: ["term", "termId", "menteeId", "mentorId", "projectId", "domainId", "status"],
  },
];

const check = (page: (typeof PAGES)[number], current: string, next: string, formMethod?: string) =>
  page.shouldRevalidate({
    currentUrl: new URL(`https://dali.test${page.path}${current}`),
    nextUrl: new URL(`https://dali.test${page.path}${next}`),
    formMethod,
    defaultShouldRevalidate: true,
  } as ShouldRevalidateFunctionArgs);

describe.each(PAGES)("$name shouldRevalidate", (page) => {
  it("skips a search change", () => {
    expect(check(page, "", "?q=ada")).toBe(false);
    expect(check(page, "?q=ada", "?q=grace")).toBe(false);
  });

  it("skips a filter builder change", () => {
    expect(check(page, "", "?f.domain=Design")).toBe(false);
    expect(check(page, "?f.domain=Design", "?f=")).toBe(false);
  });

  it("reloads after a mutation", () => {
    expect(check(page, "?q=ada", "?q=ada", "POST")).toBe(true);
  });

  it("reloads only for the params its loader reads", () => {
    for (const param of page.loaderParams) {
      expect(check(page, "?q=ada", `?q=ada&${param}=x`)).toBe(true);
    }
    expect(check(page, "", "?unrelated=x")).toBe(false);
  });
});
