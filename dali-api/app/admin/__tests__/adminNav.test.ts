import { describe, it, expect } from "vitest";
import {
  ADMIN_SECTIONS,
  adminTrail,
  sectionByKey,
  sectionLanding,
  visibleTabs,
} from "~/admin/adminNav";
import { LEGACY_REDIRECTS, resolveLegacyRedirect } from "~/lib/legacy-redirects";

const accounts = sectionByKey("accounts")!;
const platform = sectionByKey("platform")!;
const payroll = sectionByKey("payroll")!;

describe("visibleTabs", () => {
  it("hides admin-only tabs from Core members", () => {
    expect(visibleTabs(accounts, false).map((t) => t.key)).toEqual(["security"]);
    expect(visibleTabs(accounts, true).map((t) => t.key)).toEqual(["users", "security"]);
  });

  it("hides every tab of an admin-only section from Core members", () => {
    expect(visibleTabs(payroll, false)).toEqual([]);
    expect(visibleTabs(payroll, true).map((t) => t.key)).toEqual(["hire-setup", "reconcile"]);
  });

  it("hides a flagged tab until its flag is on for the viewer", () => {
    expect(visibleTabs(platform, true).map((t) => t.key)).toEqual(["jobs", "flags"]);
    expect(visibleTabs(platform, true, { "infra-dashboard": true }).map((t) => t.key)).toEqual([
      "jobs",
      "infrastructure",
      "flags",
    ]);
  });
});

describe("sectionLanding", () => {
  it("opens a section on the first tab this viewer can reach", () => {
    expect(sectionLanding(accounts, true)).toBe("/admin/accounts/users");
    expect(sectionLanding(accounts, false)).toBe("/admin/accounts/security");
  });

  it("has nowhere to land a Core member in Payroll", () => {
    expect(sectionLanding(payroll, false)).toBeNull();
  });
});

describe("adminTrail", () => {
  const labels = (active: string, isAdmin = true) => adminTrail(active, isAdmin).map((c) => c.label);

  it("reads Admin › Section › Tab on a tab page", () => {
    expect(labels("outbox")).toEqual(["Admin", "Messaging", "Outbox"]);
    expect(labels("reconcile")).toEqual(["Admin", "Payroll", "Reconcile"]);
  });

  it("stops at the section for a single-tab section", () => {
    expect(labels("onboarding")).toEqual(["Admin", "Onboarding"]);
    expect(labels("rooms")).toEqual(["Admin", "Rooms"]);
  });

  it("keeps Payroll and admin-only tabs out of a Core member's switchers", () => {
    const [, section, tab] = adminTrail("security", false);
    expect(section!.siblings!.map((s) => s.label)).not.toContain("Payroll");
    expect(tab!.siblings!.map((s) => s.label)).toEqual(["Security"]);
  });

  it("gives every section switcher entry a real URL", () => {
    const [, section] = adminTrail("jobs", true);
    for (const s of section!.siblings!) expect(s.to).toMatch(/^\/admin\/[a-z-]+$/);
  });

  it("yields a lone root crumb for an unknown key, which the shell hides", () => {
    expect(labels("members")).toEqual(["Admin"]);
  });
});

describe("legacy admin URLs", () => {
  it("forwards every retired page to a tab that exists", () => {
    const tabs = new Set(ADMIN_SECTIONS.flatMap((s) => s.sections.map((t) => t.to)));
    const retired = LEGACY_REDIRECTS.filter(
      (r) => r.path.startsWith("admin/") && typeof r.to === "string" && r.to.startsWith("/admin"),
    );
    expect(retired.length).toBeGreaterThan(10);
    for (const r of retired) {
      if (r.to === "/admin") continue;
      expect(tabs.has(r.to as string) || r.to === "/admin/rooms", `${r.path} -> ${r.to}`).toBe(true);
    }
  });

  it("forwards an activity detail page and tolerates a trailing slash", () => {
    expect(resolveLegacyRedirect("/admin/activities/abc123")?.to).toBe("/admin/onboarding/abc123");
    expect(resolveLegacyRedirect("/admin/jobs/")?.to).toBe("/admin/platform/jobs");
  });

  it("leaves unknown paths alone", () => {
    expect(resolveLegacyRedirect("/admin/members")).toBeNull();
  });
});
