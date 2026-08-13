import { describe, it, expect } from "vitest";
import {
  NAV_AREAS,
  areaForPath,
  areasFor,
  activeSubtabHref,
  hasSubnavRow,
  isAreaSubtabPath,
  pinnedNavItems,
  visibleAreas,
  visibleSubtabs,
  type RoleFlags,
} from "~/lib/nav-areas";

const projects = NAV_AREAS.find((a) => a.key === "projects")!;

describe("areaForPath", () => {
  it("resolves hubs, sub-tabs and detail routes", () => {
    expect(areaForPath("/projects")?.key).toBe("projects");
    expect(areaForPath("/projects/staffing")?.key).toBe("projects");
    expect(areaForPath("/projects/abc123")?.key).toBe("projects");
    expect(areaForPath("/documents/page-1")?.key).toBe("documents");
  });

  it("still resolves an area hub that carries a query string", () => {
    // A favorited hub is stored as `pathname + search` (FavoriteRouteButton),
    // and in tab mode the sidebar matches the focused tab's url — which keeps
    // its query. Without trimming it, the hub matched no area and the sidebar
    // fell back to the last-visited area (Projects by default).
    expect(areaForPath("/education?term=25F")?.key).toBe("education");
    expect(areaForPath("/mentorship?q=x")?.key).toBe("mentorship");
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
/* nav-regroup: the role-grouped area set behind the flag              */
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

const REGROUP = { "nav-regroup": true, "drive-consolidation": true };
const LEGACY = { "nav-regroup": false, "drive-consolidation": false };

describe("area sets", () => {
  it("collapses to five areas under nav-regroup", () => {
    expect(areasFor(REGROUP).map((a) => a.key)).toEqual([
      "projects",
      "education",
      "core",
      "hiring",
      "admin",
    ]);
  });

  it("leaves the pre-regroup set alone when the flag is off", () => {
    const keys = areasFor(LEGACY).map((a) => a.key);
    expect(keys).toContain("members");
    expect(keys).toContain("partners");
    expect(keys).toContain("mentorship");
    expect(keys).not.toContain("core");
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
        "/core/level-up",
        "/core/access",
        "/core/communications",
        "/core/attendance",
      ]),
    );
  });

  it("only offers Forms while Drive is off", () => {
    const withDrive = areasFor(REGROUP).find((a) => a.key === "core")!;
    expect(visibleSubtabs(withDrive, CORE).map((t) => t.href)).not.toContain("/forms");

    const noDrive = areasFor({ "nav-regroup": true, "drive-consolidation": false })
      .find((a) => a.key === "core")!;
    expect(visibleSubtabs(noDrive, CORE).map((t) => t.href)).toContain("/forms");
  });
});

describe("Admin area", () => {
  it("keeps only system clusters under nav-regroup", () => {
    const admin = areasFor(REGROUP).find((a) => a.key === "admin")!;
    const labels = admin.subtabs.map((t) => t.label);
    expect(labels).not.toContain("People & Access");
    expect(labels).not.toContain("Communications");
    expect(labels).toEqual(
      expect.arrayContaining(["Hub", "Documents", "Finance", "System & Insights"]),
    );
  });

  it("keeps every cluster when the flag is off", () => {
    const admin = areasFor(LEGACY).find((a) => a.key === "admin")!;
    const labels = admin.subtabs.map((t) => t.label);
    expect(labels).toContain("People & Access");
    expect(labels).toContain("Communications");
  });
});

describe("areaForPath", () => {
  it("routes /core paths to Core and /projects paths to Projects", () => {
    expect(areaForPath("/core/staffing", REGROUP)?.key).toBe("core");
    expect(areaForPath("/core/access/roles", REGROUP)?.key).toBe("core");
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

  it("keeps borrowed sub-tabs inside Projects", () => {
    // /members, /partners and /mentorship are Projects sub-tabs but sit outside
    // its hubPath, so prefix matching alone would strand them.
    expect(areaForPath("/members", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/members/abc", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/partners/applications", REGROUP)?.key).toBe("projects");
    expect(areaForPath("/mentorship/browse", REGROUP)?.key).toBe("projects");
  });

  it("still resolves the pre-regroup URLs when the flag is off", () => {
    expect(areaForPath("/projects/staffing", LEGACY)?.key).toBe("projects");
    expect(areaForPath("/members", LEGACY)?.key).toBe("members");
    expect(areaForPath("/admin/people", LEGACY)?.key).toBe("admin");
  });

  it("ignores the query string", () => {
    expect(areaForPath("/core/staffing?term=25F", REGROUP)?.key).toBe("core");
  });
});

describe("pinnedNavItems", () => {
  it("pins nothing before the regroup", () => {
    expect(pinnedNavItems(LEGACY)).toEqual([]);
  });

  it("pins Drive once regrouped", () => {
    expect(pinnedNavItems(REGROUP).map((i) => i.href)).toEqual(["/drive"]);
  });

  it("falls back to Documents when Drive is off", () => {
    const pinned = pinnedNavItems({ "nav-regroup": true, "drive-consolidation": false });
    expect(pinned.map((i) => i.href)).toEqual(["/documents"]);
    expect(pinned[0].label).toBe("Documents");
  });
});
