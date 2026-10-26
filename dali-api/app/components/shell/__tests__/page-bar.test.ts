import { describe, expect, it } from "vitest";
import { fallbackPageLabel, pageBarCrumbs } from "~/components/shell/page-bar-model";
import { resolvePageBarTrail } from "~/components/Breadcrumbs";
import { itemTrail, noteTrail } from "~/components/notebooks/note-trail";
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

  it("names a section page the way the rail does, not by its page title", () => {
    expect(labels(pageBarCrumbs({ path: "/members", trail: [], title: "Directory" }))).toEqual(["Lab", "People"]);
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

describe("a document's Drive path", () => {
  const location = {
    scopeId: "lab",
    scopeLabel: "General",
    folderId: "f2",
    folders: [
      { id: "f1", title: "Design" },
      { id: "f2", title: "Wayfinding" },
    ],
    path: "General › Design › Wayfinding",
  };

  it("lists the space by the name the Drive shows, then every folder, linking each into the Drive", () => {
    expect(itemTrail(location, "test")).toEqual([
      { label: "Lab", to: "/drive?scope=lab" },
      { label: "Design", to: "/drive?scope=lab&folder=f1" },
      { label: "Wayfinding", to: "/drive?scope=lab&folder=f2" },
      { label: "test" },
    ]);
  });

  it("shows the Drive's open space and folder, without repeating Drive", () => {
    const driveTrail = [{ label: "Drive", to: "/drive" }, ...itemTrail(location, "").slice(0, -1)];
    expect(labels(pageBarCrumbs({ path: "/drive?scope=lab&folder=f2", trail: driveTrail, title: "Drive" }))).toEqual([
      "Drive",
      "Lab",
      "Design",
      "Wayfinding",
    ]);
  });

  it("reads as Drive, then that path, in the page bar", () => {
    expect(
      labels(pageBarCrumbs({ path: "/documents/p1", trail: itemTrail(location, "test"), title: "test" })),
    ).toEqual(["Drive", "Lab", "Design", "Wayfinding", "test"]);
  });

  it("keeps a note's notebook in its trail", () => {
    expect(labels(noteTrail(location, { id: "nb", title: "Weekly sync" }, "Oct 22"))).toEqual([
      "Lab",
      "Design",
      "Wayfinding",
      "Weekly sync",
      "Oct 22",
    ]);
  });
});

describe("resolvePageBarTrail", () => {
  const docMatch = (data: unknown) => ({
    pathname: "/documents/p1",
    data,
    handle: {
      hideBreadcrumbs: true,
      shellTrail: (d: unknown) => (d as { trail: { label: string }[] | null }).trail,
    },
  });

  it("uses the route's shell trail when the route has no trail of its own", () => {
    const trail = resolvePageBarTrail(
      [docMatch({ trail: [{ label: "General", to: "/drive?scope=lab" }, { label: "test" }] })],
      "/documents/p1",
      "",
    );
    expect(labels(trail!.crumbs)).toEqual(["General", "test"]);
  });

  it("stays out of the way when the route has no shell trail", () => {
    expect(resolvePageBarTrail([docMatch({ trail: null })], "/documents/p1", "")).toBeNull();
  });

  it("prefers a trail the route builds itself", () => {
    const match = {
      pathname: "/documents/p1",
      data: {},
      handle: {
        breadcrumbTrail: () => [{ label: "Notebook", to: "/documents/nb" }, { label: "Tab" }],
        shellTrail: () => [{ label: "General", to: "/drive?scope=lab" }, { label: "Other" }],
      },
    };
    expect(labels(resolvePageBarTrail([match], "/documents/p1", "")!.crumbs)).toEqual(["Notebook", "Tab"]);
  });
});
