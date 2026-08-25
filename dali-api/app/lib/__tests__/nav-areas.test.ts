import { describe, it, expect } from "vitest";
import {
  NAV_AREAS,
  areaForPath,
  areasFor,
  activeSubtabHref,
  hasSubnavRow,
  isAreaSubtabPath,
  isPinnedActive,
  pinnedNavItems,
  visibleAreas,
  visibleSubtabs,
  type RoleFlags,
} from "~/lib/nav-areas";
import { ADMIN_CLUSTERS } from "~/admin/adminNav";

const projects = NAV_AREAS.find((a) => a.key === "projects")!;

describe("areaForPath", () => {
  it("resolves hubs, sub-tabs and detail routes", () => {
    expect(areaForPath("/projects")?.key).toBe("projects");
    expect(areaForPath("/projects/staffing")?.key).toBe("projects");
    expect(areaForPath("/projects/abc123")?.key).toBe("projects");
    expect(areaForPath("/core")?.key).toBe("core");
  });

  it("still resolves an area hub that carries a query string", () => {
    // A favorited hub is stored as `pathname + search` (FavoriteRouteButton),
    // and in tab mode the sidebar matches the focused tab's url — which keeps
    // its query. Without trimming it, the hub matched no area and the sidebar
    // fell back to the last-visited area (Projects by default).
    expect(areaForPath("/education?term=25F")?.key).toBe("education");
    expect(areaForPath("/hiring?q=x")?.key).toBe("hiring");
    expect(areaForPath("/projects#top")?.key).toBe("projects");
  });

  it("returns undefined for paths outside every area", () => {
    expect(areaForPath("/calendar")).toBeUndefined();
    expect(areaForPath("/notifications?filter=open")).toBeUndefined();
  });
});

describe("activeSubtabHref", () => {
  it("highlights the sub-tab owning the path", () => {
    expect(activeSubtabHref(projects, "/projects")).toBe("/projects");
    expect(activeSubtabHref(projects, "/projects/staffing")).toBe("/projects/staffing");
  });

  it("keeps the highlight when the sub-tab url carries a filter query", () => {
    expect(activeSubtabHref(projects, "/projects/staffing?term=25F")).toBe(
      "/projects/staffing",
    );
    expect(activeSubtabHref(projects, "/projects?term=25F")).toBe("/projects");
  });

  it("leaves a record page unhighlighted — it is not the hub", () => {
    expect(activeSubtabHref(projects, "/projects/abc123")).toBeUndefined();
    expect(activeSubtabHref(projects, "/projects/abc123?tab=tasks")).toBeUndefined();
  });
});

describe("isAreaSubtabPath", () => {
  it("recognises a sub-tab landing page with or without a query", () => {
    expect(isAreaSubtabPath("/projects/staffing")).toBe(true);
    expect(isAreaSubtabPath("/projects/staffing?term=25F")).toBe(true);
  });

  it("excludes hubs and record pages", () => {
    expect(isAreaSubtabPath("/projects")).toBe(false);
    expect(isAreaSubtabPath("/projects/abc123")).toBe(false);
  });

  it("recognises sub-tabs from BOTH area sets, so favorites survive the flag flip", () => {
    expect(isAreaSubtabPath("/core/staffing")).toBe(true);
    expect(isAreaSubtabPath("/projects/staffing")).toBe(true);
    expect(isAreaSubtabPath("/members/groups")).toBe(true);
  });
});

// Regression: the tabless history arrows and the layout's flush top padding
// both stand down when a page renders its own nav row. Layout used to decide
// that from `handle.areaPills` alone, which broke both ways — calendar
// (areaSubnav) got a standalone arrow bar stacked on top of its own subnav
// row, and under the sidebar redesign areaPills pages hid the bar for a pill
// row AreaPillNav no longer renders.
describe("hasSubnavRow", () => {
  const m = (handle: unknown) => [{ handle }];

  it("is true for areaSubnav routes whether or not the redesign is on", () => {
    expect(hasSubnavRow(m({ areaSubnav: true }), false)).toBe(true);
    expect(hasSubnavRow(m({ areaSubnav: true }), true)).toBe(true);
  });

  it("is true for areaPills routes only while the redesign is off", () => {
    expect(hasSubnavRow(m({ areaPills: true }), false)).toBe(true);
    expect(hasSubnavRow(m({ areaPills: true }), true)).toBe(false);
  });

  it("is false for a plain route, and tolerates handle-less matches", () => {
    expect(hasSubnavRow(m({}), false)).toBe(false);
    expect(hasSubnavRow([{}, { handle: undefined }], false)).toBe(false);
  });

  it("takes the signal from any match in the chain, not just the leaf", () => {
    expect(hasSubnavRow([{ handle: {} }, { handle: { areaSubnav: true } }], true)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* the role-grouped area set (nav-regroup flag retired — always on)    */
/* ------------------------------------------------------------------ */

const NOBODY: RoleFlags = {
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInterviewer: false,
  canViewForms: false,
  canViewStaffing: false,
  hasHiringAccess: false,
  hasActiveHiringAccess: false,
  isLabMentor: false,
  isInstructor: false,
};
const CORE: RoleFlags = { ...NOBODY, isCore: true, canViewForms: true, canViewStaffing: true };

// nav-regroup was retired — the role-grouped set is the only nav, and areasFor
// ignores flags. An empty map documents that at the call sites.
const REGROUP = {};

describe("area sets", () => {
  it("collapses to five areas", () => {
    expect(areasFor(REGROUP).map((a) => a.key)).toEqual([
      "projects",
      "education",
      "core",
      "hiring",
      "admin",
    ]);
  });

  it("returns the role-grouped set with no args at all", () => {
    expect(areasFor().map((a) => a.key)).toEqual([
      "projects",
      "education",
      "core",
      "hiring",
      "admin",
    ]);
  });

  it("shows a regular member only Projects and Education", () => {
    expect(visibleAreas(NOBODY, REGROUP).map((a) => a.key)).toEqual([
      "projects",
      "education",
    ]);
  });

  it("gives Core every area", () => {
    expect(visibleAreas(CORE, REGROUP).map((a) => a.key)).toEqual([
      "projects",
      "education",
      "core",
      "admin",
    ]);
  });

  it("shows Hiring to a member on a live cycle, and not to one who is off it", () => {
    const onCycle = { ...NOBODY, hasActiveHiringAccess: true };
    expect(visibleAreas(onCycle, REGROUP).map((a) => a.key)).toContain("hiring");
    // hasHiringAccess (any cycle, ever) must NOT open the regrouped tab.
    const pastReviewer = { ...NOBODY, hasHiringAccess: true };
    expect(visibleAreas(pastReviewer, REGROUP).map((a) => a.key)).not.toContain("hiring");
  });
});

describe("Core area", () => {
  const core = () => areasFor(REGROUP).find((a) => a.key === "core")!;

  it("owns the process pages moved out of Projects and Admin", () => {
    const hrefs = core().subtabs.map((t) => t.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/core",
        "/core/staffing",
        "/core/intent-to-work",
        "/core/project-bids",
        "/core/growth",
        "/core/access/roles",
        "/core/access/domains",
        "/core/communications",
        "/core/attendance",
      ]),
    );
  });

  it("never offers Forms as a Core sub-tab — forms live in the Drive", () => {
    const core = areasFor(REGROUP).find((a) => a.key === "core")!;
    expect(visibleSubtabs(core, CORE).map((t) => t.href)).not.toContain("/forms");
  });
});

describe("Admin area", () => {
  it("keeps only system clusters", () => {
    const admin = areasFor(REGROUP).find((a) => a.key === "admin")!;
    const labels = admin.subtabs.map((t) => t.label);
    expect(labels).not.toContain("People & Access");
    expect(labels).not.toContain("Communications");
    // Documents is gone entirely — Agreements, its only page, is a Core sub-tab.
    expect(labels).not.toContain("Documents");
    expect(labels).toEqual(
      expect.arrayContaining(["Hub", "Finance", "System & Insights"]),
    );
  });
});

describe("admin cluster allocation", () => {
  it("is strictly system-level — no People & Access or Communications clusters", () => {
    const keys = ADMIN_CLUSTERS.map((c) => c.key);
    expect(keys).not.toContain("people");
    expect(keys).not.toContain("communications");
    expect(keys).toEqual(expect.arrayContaining(["finance", "system"]));
  });

  it("files Email Senders and Outbound Messages under System & Insights", () => {
    const system = ADMIN_CLUSTERS.find((c) => c.key === "system")!;
    const sectionKeys = system.sections.map((s) => s.key);
    expect(sectionKeys).toEqual(
      expect.arrayContaining([
        "analytics",
        "ai-usage",
        "activity",
        "jobs",
        "feature-flags",
        "email-senders",
        "outbound-messages",
      ]),
    );
  });
});

describe("areaForPath", () => {
  it("routes /core paths to Core and /projects paths to Projects", () => {
    expect(areaForPath("/core/staffing", REGROUP)?.key).toBe("core");
    expect(areaForPath("/core/access/roles", REGROUP)?.key).toBe("core");
    // Agreements now lives at its own /core URL (its permanent console hub).
    expect(areaForPath("/core/agreements", REGROUP)?.key).toBe("core");
    expect(areaForPath("/core/agreements/abc123", REGROUP)?.key).toBe("core");
    expect(areaForPath("/admin/email-senders", REGROUP)?.key).toBe("admin");
    expect(areaForPath("/projects/42", REGROUP)?.key).toBe("projects");
  });

  it("keeps Groups reachable, gated as before", () => {
    const projectsArea = areasFor(REGROUP).find((a) => a.key === "projects")!;
    expect(visibleSubtabs(projectsArea, CORE).map((t) => t.href)).toContain(
      "/members/groups",
    );
    expect(visibleSubtabs(projectsArea, NOBODY).map((t) => t.href)).not.toContain(
      "/members/groups",
    );
  });

  it("injects the Domains sub-tab into General only when domain-hubs is on", () => {
    const generalOff = areasFor(REGROUP).find((a) => a.key === "projects")!;
    expect(generalOff.subtabs.map((t) => t.href)).not.toContain("/domains");

    const generalOn = areasFor({ "domain-hubs": true }).find(
      (a) => a.key === "projects",
    )!;
    const hrefs = generalOn.subtabs.map((t) => t.href);
    expect(hrefs).toContain("/domains");
    // Sits right after Projects, before People.
    expect(hrefs.indexOf("/domains")).toBe(hrefs.indexOf("/projects") + 1);
    expect(hrefs.indexOf("/domains")).toBeLessThan(hrefs.indexOf("/members"));
  });

  it("keeps borrowed sub-tabs inside Projects", () => {
    // /members, /partners and /mentorship are Projects sub-tabs but sit outside
    // its hubPath, so prefix matching alone would strand them.
    expect(areaForPath("/members", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/members/abc", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/partners/applications", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/mentorship/browse", REGROUP)?.key).toBe("projects");
  });

  it("still resolves pre-regroup URLs to an area (they redirect at the route layer)", () => {
    // These addresses now 302 to their canonical /core (or /admin) path, but the
    // matcher must still place them so the redirecting hop highlights an area.
    expect(areaForPath("/projects/staffing")?.key).toBe("projects");
    expect(areaForPath("/admin/people")?.key).toBe("admin");
    expect(areaForPath("/admin/email-senders")?.key).toBe("admin");
  });

  it("ignores the query string", () => {
    expect(areaForPath("/core/staffing?term=25F", REGROUP)?.key).toBe("core");
  });

  it("leaves plain Drive urls unowned once regrouped (the pin, not an area, wins)", () => {
    // Drive is a pinned item after the regroup with no area to fall back on, so a
    // Drive url — filtered or not — belongs to no area. (Agreements used to claim
    // /drive?type=agreement via the query-scope rule; it now has its own /core
    // console instead, so that filtered url is back to the plain Drive.)
    expect(areaForPath("/drive", REGROUP)).toBeUndefined();
    expect(areaForPath("/drive?type=file", REGROUP)).toBeUndefined();
    expect(areaForPath("/drive?type=agreement", REGROUP)).toBeUndefined();
    expect(areaForPath("/drive/abc123", REGROUP)).toBeUndefined();
  });

  it("owns and highlights the Agreements console at its plain /core URL", () => {
    const core = areasFor(REGROUP).find((a) => a.key === "core")!;
    expect(areaForPath("/core/agreements", REGROUP)?.key).toBe("core");
    expect(activeSubtabHref(core, "/core/agreements")).toBe("/core/agreements");
    expect(activeSubtabHref(core, "/core/agreements/abc123")).toBe("/core/agreements");
  });
});

describe("isPinnedActive", () => {
  it("lights the Drive pin on plain Drive urls, including filters and subtrees", () => {
    expect(isPinnedActive("/drive", "/drive", REGROUP)).toBe(true);
    expect(isPinnedActive("/drive?type=file", "/drive", REGROUP)).toBe(true);
    expect(isPinnedActive("/drive?scope=core", "/drive", REGROUP)).toBe(true);
    expect(isPinnedActive("/drive/abc123", "/drive", REGROUP)).toBe(true);
  });

  it("lights the Drive pin on filtered Drive urls (no Core deep-link claims them now)", () => {
    // Agreements no longer deep-links into the Drive, so a filtered Drive url is
    // owned by the pin again, not a Core sub-tab.
    expect(isPinnedActive("/drive?type=agreement", "/drive", REGROUP)).toBe(true);
    expect(isPinnedActive("/drive?type=emailTemplate", "/drive", REGROUP)).toBe(true);
  });

  it("is false for unrelated paths", () => {
    expect(isPinnedActive("/projects", "/drive", REGROUP)).toBe(false);
    expect(isPinnedActive("/core/staffing", "/drive", REGROUP)).toBe(false);
  });
});

describe("pinnedNavItems", () => {
  it("pins Drive", () => {
    expect(pinnedNavItems(REGROUP).map((i) => i.href)).toEqual(["/drive"]);
    expect(pinnedNavItems().map((i) => i.href)).toEqual(["/drive"]);
  });
});
