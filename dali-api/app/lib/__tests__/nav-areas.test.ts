import { describe, it, expect } from "vitest";
import {
  NAV_AREAS,
  areaForPath,
  activeSubtabHref,
  hasSubnavRow,
  isAreaSubtabPath,
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
