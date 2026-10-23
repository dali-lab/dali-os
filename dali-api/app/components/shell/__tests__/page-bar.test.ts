import { describe, expect, it } from "vitest";
import { trailCrumbsOrTitle } from "~/components/Breadcrumbs";
import { starLabels } from "~/components/shell/PageBar";

const trail = (labels: string[]) => ({
  crumbs: labels.map((label) => ({ label })),
  action: null,
  favoriteRoute: false,
});

describe("trailCrumbsOrTitle", () => {
  it("uses the trail when it has more than one crumb", () => {
    expect(trailCrumbsOrTitle(trail(["Lab", "Project"]), "Project").map((c) => c.label)).toEqual(["Lab", "Project"]);
  });

  it("falls back to the page title for a single crumb", () => {
    expect(trailCrumbsOrTitle(trail(["Settings"]), "Settings").map((c) => c.label)).toEqual(["Settings"]);
  });

  it("falls back to the page title when the route has no trail", () => {
    expect(trailCrumbsOrTitle(null, "Home")).toEqual([{ label: "Home" }]);
  });

  it("shows nothing when there is neither trail nor title", () => {
    expect(trailCrumbsOrTitle(null, "")).toEqual([]);
  });
});

describe("starLabels", () => {
  it("offers to add an unstarred page", () => {
    expect(starLabels({ favorited: false, inSidebar: false })).toEqual({
      tooltip: "Add this page to favorites",
      aria: "Add this page to favorites",
    });
  });

  it("offers to remove a starred page", () => {
    expect(starLabels({ favorited: true, inSidebar: false }).tooltip).toBe("Remove this page from favorites");
  });

  it("explains a page that already lives in the sidebar", () => {
    expect(starLabels({ favorited: false, inSidebar: true }).tooltip).toBe("Already in the sidebar");
  });
});
