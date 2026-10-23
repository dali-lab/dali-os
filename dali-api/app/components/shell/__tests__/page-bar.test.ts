import { describe, expect, it } from "vitest";
import { fallbackPageLabel, pageBarCrumbs } from "~/components/shell/page-bar-model";
import { starLabels } from "~/components/shell/PageBar";

const labels = (crumbs: { label: string }[]) => crumbs.map((c) => c.label);

describe("pageBarCrumbs", () => {
  it("leads with the area the page belongs to", () => {
    expect(
      labels(
        pageBarCrumbs({
          path: "/projects/abc",
          trail: [{ label: "Projects", to: "/projects" }, { label: "DALI OS" }],
          title: "DALI OS",
        }),
      ),
    ).toEqual(["Lab", "Projects", "DALI OS"]);
  });

  it("links every crumb but the leaf", () => {
    const crumbs = pageBarCrumbs({
      path: "/projects/abc",
      trail: [{ label: "Projects", to: "/projects" }, { label: "DALI OS", to: "/projects/abc" }],
      title: "DALI OS",
    });
    expect(crumbs.map((c) => c.to)).toEqual(["/projects", "/projects", undefined]);
  });

  it("puts a sub-tab page under its area", () => {
    expect(labels(pageBarCrumbs({ path: "/projects", trail: [{ label: "Projects" }], title: "Projects" }))).toEqual([
      "Lab",
      "Projects",
    ]);
  });

  it("names a destination with no page title, instead of the app name", () => {
    expect(labels(pageBarCrumbs({ path: "/calendar", trail: [], title: "" }))).toEqual(["Calendar"]);
  });

  it("does not repeat the destination when the page is titled the same", () => {
    expect(labels(pageBarCrumbs({ path: "/email", trail: [], title: "Email" }))).toEqual(["Email"]);
  });

  it("files a document under Drive", () => {
    expect(labels(pageBarCrumbs({ path: "/documents/p1", trail: [{ label: "test" }], title: "test" }))).toEqual([
      "Drive",
      "test",
    ]);
  });

  it("follows a route's own trail home over the url prefix", () => {
    expect(
      labels(
        pageBarCrumbs({
          path: "/documents/file/f1",
          trail: [{ label: "Projects", to: "/projects" }, { label: "Hood AR", to: "/projects/h" }, { label: "spec.pdf" }],
          title: "spec.pdf",
        }),
      ),
    ).toEqual(["Lab", "Projects", "Hood AR", "spec.pdf"]);
  });

  it("shows Home on the home page", () => {
    expect(labels(pageBarCrumbs({ path: "/", trail: [], title: "" }))).toEqual(["Home"]);
  });

  it("shows just the title for a page outside any section", () => {
    expect(labels(pageBarCrumbs({ path: "/settings", trail: [], title: "Settings" }))).toEqual(["Settings"]);
  });

  it("shows nothing with no section, trail or title", () => {
    expect(pageBarCrumbs({ path: "/settings", trail: [], title: "" })).toEqual([]);
  });
});

describe("fallbackPageLabel", () => {
  it("names the destinations and home", () => {
    expect(fallbackPageLabel("/calendar?view=week")).toBe("Calendar");
    expect(fallbackPageLabel("/rooms")).toBe("Calendar");
    expect(fallbackPageLabel("/")).toBe("Home");
  });

  it("is empty elsewhere", () => {
    expect(fallbackPageLabel("/projects")).toBe("");
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
