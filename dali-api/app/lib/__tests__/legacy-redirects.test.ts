import { describe, expect, it } from "vitest";
import { matchPath } from "react-router";
import { LEGACY_REDIRECTS, resolveLegacyRedirect } from "~/lib/legacy-redirects";

type Case = [from: string, to: string, status: 301 | 302];

const CASES: Case[] = [
  ["/admin/system", "/admin", 301],
  ["/admin/payroll-export?x=1", "/admin/payroll/hire-setup?x=1", 301],
  ["/admin/site-users", "/admin/accounts/users", 301],
  ["/admin/security", "/admin/accounts/security", 301],
  ["/admin/outbound-messages?status=Dead&q=x", "/admin/messaging/outbox?status=Dead&q=x", 301],
  ["/admin/email-senders", "/admin/messaging/senders", 301],
  ["/admin/analytics", "/admin/insights/analytics", 301],
  ["/admin/ai-usage", "/admin/insights/ai-usage", 301],
  ["/admin/activity", "/admin/insights/audit-log", 301],
  ["/admin/jobs/", "/admin/platform/jobs", 301],
  ["/admin/infrastructure", "/admin/platform/infrastructure", 301],
  ["/admin/feature-flags", "/admin/platform/flags", 301],
  ["/admin/activities", "/admin/onboarding", 301],
  ["/admin/activities/abc123?tab=x", "/admin/onboarding/abc123?tab=x", 301],
  ["/core/rooms?room=1", "/admin/rooms?room=1", 301],

  ["/hiring/emails?x=1", "/core/communications/email", 302],
  ["/hiring/emails/t1", "/core/communications/email", 302],
  ["/admin/email-templates", "/core/communications/email", 302],
  ["/admin/email-templates/t1?x=1", "/core/communications/email", 302],
  ["/core/communications/email/t1", "/core/communications/email", 302],

  ["/partners?embed=1", "/core/partners/directory?embed=1", 302],
  ["/partners/applications", "/core/partners", 302],
  ["/partners/applications/abc123?tab=activity", "/core/partners/applications/abc123?tab=activity", 302],
  ["/partners/acme-org?embed=1", "/core/partners/orgs/acme-org?embed=1", 302],

  ["/connect", "/community", 301],
  ["/connect/opportunities?q=x", "/community/opportunities?q=x", 301],
  ["/connect/gallery/p1", "/community/gallery/p1", 301],
  ["/intern-to-full?x=1", "/fellowship", 301],
  ["/help/calendar?x=1", "/help/articles/calendar", 301],

  ["/internal-processes/level-up?term=t1", "/core/level-up?term=t1", 302],
  ["/core/access/roles?x=1", "/core/access?x=1", 302],
  ["/core/access/domains", "/core/access", 302],
  ["/core/communications/email-senders?x=1", "/admin/messaging/senders", 302],
  ["/admin/people?x=1", "/core/access", 302],
  ["/admin/communications?x=1", "/core/communications", 302],
  ["/education/manage?term=t1", "/education/offerings?term=t1", 302],

  ["/hiring/reviewer?cycle=c1", "/hiring?cycle=c1&view=reviews", 302],
  ["/hiring/reviewer?view=delibs&cycle=c1", "/hiring?view=delibs&cycle=c1", 302],
  ["/hiring/reviewer?view=other", "/hiring?view=reviews", 302],
  ["/hiring/interviews?cycle=c1", "/hiring?cycle=c1&view=interviews", 302],
  ["/hiring/analytics?cycleId=c%201&x=1", "/hiring/applications?cycle=c%201", 302],
  ["/hiring/analytics", "/hiring/applications", 302],
  ["/hiring/lead/internal-cycle/c1?tab=setup", "/hiring/lead/cycle/c1?tab=setup", 302],
  ["/forms/responses/f1", "/forms/edit/f1?view=results", 302],
  ["/forms/responses/f1?version=3&x=1", "/forms/edit/f1?view=results&version=3", 302],

  ["/projects/staffing?term=25F", "/core/staffing?term=25F", 302],
  ["/projects/intent-to-work", "/core/intent-to-work", 302],
  ["/projects/intent-to-work/u1?term=x", "/core/intent-to-work/u1?term=x", 302],
  ["/projects/project-bids", "/core/project-bids", 302],
  ["/projects/project-bids/u1?term=x", "/core/project-bids/u1?term=x", 302],
  ["/projects/level-up", "/core/level-up", 302],
  ["/projects/level-up/u1?term=x", "/core/level-up/u1?term=x", 302],
  ["/admin/announcements?formId=f1&audience=all", "/core/communications/announcements?formId=f1&audience=all", 302],
  ["/admin/email?key=hiring%3Adecision%3ARejected", "/core/communications/email?key=hiring%3Adecision%3ARejected", 302],
];

describe("resolveLegacyRedirect", () => {
  it.each(CASES)("%s -> %s (%i)", (from, to, status) => {
    const [pathname, search = ""] = from.split(/(?=\?)/);
    expect(resolveLegacyRedirect(pathname!, search)).toEqual({ to, status });
  });

  it("has a case for every entry in the table", () => {
    const covered = new Set<string>();
    for (const [from] of CASES) {
      const [pathname] = from.split(/(?=\?)/);
      const entry = LEGACY_REDIRECTS.find((r) => matchPath({ path: r.path, end: true }, pathname!));
      if (entry) covered.add(entry.path);
    }
    expect([...covered].sort()).toEqual(LEGACY_REDIRECTS.map((r) => r.path).sort());
  });

  it("returns null for paths that are not retired", () => {
    expect(resolveLegacyRedirect("/core/staffing")).toBeNull();
    expect(resolveLegacyRedirect("/admin/members")).toBeNull();
    expect(resolveLegacyRedirect("/partner/projects")).toBeNull();
    expect(resolveLegacyRedirect("/help/articles/calendar")).toBeNull();
  });

  it("has unique paths", () => {
    const paths = LEGACY_REDIRECTS.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
