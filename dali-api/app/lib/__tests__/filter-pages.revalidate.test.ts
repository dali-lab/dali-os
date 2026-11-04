import { describe, expect, it, vi } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";

vi.mock("~/lib/db.server");

import * as partnersBoard from "~/partners/routes/core.partners";
import * as partnersDirectory from "~/partners/routes/core.partners.directory";
import * as members from "~/members/routes/members";
import * as mentorship from "~/mentorship/routes/mentorship.browse";
import * as infrastructure from "~/admin/routes/admin.infrastructure";
import * as announcements from "~/admin/routes/admin.announcements";
import * as listserv from "~/core/routes/core.communications.listserv";
import * as banners from "~/core/routes/core.communications.banners";
import * as planning from "~/partners/routes/core.partners.planning";
import * as payrollExport from "~/admin/routes/admin.payroll-export";
import * as notifications from "~/routes/notifications";
import * as partnersRenewals from "~/partners/routes/core.partners.renewals";
import * as applications from "~/hiring/routes/applications";

type ShouldRevalidate = (args: ShouldRevalidateFunctionArgs) => boolean;

const PAGES: {
  name: string;
  path: string;
  shouldRevalidate: ShouldRevalidate;
  loaderParams: string[];
}[] = [
  { name: "Partners board", path: "/core/partners", shouldRevalidate: partnersBoard.shouldRevalidate, loaderParams: [] },
  { name: "Partners directory", path: "/core/partners/directory", shouldRevalidate: partnersDirectory.shouldRevalidate, loaderParams: [] },
  { name: "Renewals", path: "/core/partners/renewals", shouldRevalidate: partnersRenewals.shouldRevalidate, loaderParams: ["term"] },
  { name: "Applications", path: "/hiring/applications", shouldRevalidate: applications.shouldRevalidate, loaderParams: ["cycle"] },
  { name: "Members", path: "/members", shouldRevalidate: members.shouldRevalidate, loaderParams: ["status", "domain", "project", "class"] },
  {
    name: "Mentorship browse",
    path: "/mentorship/browse",
    shouldRevalidate: mentorship.shouldRevalidate,
    loaderParams: ["term", "termId", "menteeId", "mentorId", "projectId", "domainId", "status"],
  },
  { name: "Infrastructure", path: "/admin/infrastructure", shouldRevalidate: infrastructure.shouldRevalidate, loaderParams: ["term"] },
  { name: "Announcements", path: "/admin/announcements", shouldRevalidate: announcements.shouldRevalidate, loaderParams: [] },
  { name: "Listserv", path: "/core/communications/listserv", shouldRevalidate: listserv.shouldRevalidate, loaderParams: [] },
  { name: "Banners", path: "/core/communications/banners", shouldRevalidate: banners.shouldRevalidate, loaderParams: [] },
  { name: "Planning", path: "/core/partners/planning", shouldRevalidate: planning.shouldRevalidate, loaderParams: ["term"] },
  { name: "Payroll export", path: "/admin/payroll/hire-setup", shouldRevalidate: payrollExport.shouldRevalidate, loaderParams: ["term", "domain", "level"] },
  { name: "Notifications", path: "/notifications", shouldRevalidate: notifications.shouldRevalidate, loaderParams: ["tab"] },
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

  it("skips a tab, view or status switch the loader doesn't read", () => {
    for (const param of ["tab", "view", "status", "group", "role"].filter((p) => !page.loaderParams.includes(p))) {
      expect(check(page, "", `?${param}=x`)).toBe(false);
    }
  });

  it("skips sort, display and other client-side view params", () => {
    const viewParams = ["sort", "dir", "paused", "rejected", "stage", "pie", "status", "domain", "event", "engagement"];
    for (const param of viewParams.filter((p) => !page.loaderParams.includes(p))) {
      expect(check(page, "", `?${param}=x`)).toBe(false);
    }
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
