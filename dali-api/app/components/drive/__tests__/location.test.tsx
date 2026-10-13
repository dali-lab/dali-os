import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { crumbsFor, locateFolder, locateItem, locationOf, type LocatableScope } from "~/components/drive/location";
import { LocationLink } from "~/components/drive/LocationLink";

const item = (id: string, title: string, parentFolderId: string | null = null) => ({ id, title, parentFolderId });

const scopes: LocatableScope[] = [
  {
    id: "mine",
    label: "My Drive",
    items: [item("a", "Alpha"), item("b", "Beta", "a"), item("c", "Gamma", "b"), item("d", "Loose doc")],
  },
  { id: "lab", label: "Lab-wide", items: [item("x", "")] },
];

describe("crumbsFor", () => {
  it("walks from the top folder down to the given one", () => {
    expect(crumbsFor(scopes[0].items, "c")).toEqual([
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
      { id: "c", title: "Gamma" },
    ]);
  });

  it("is empty at the top level", () => {
    expect(crumbsFor(scopes[0].items, null)).toEqual([]);
  });

  it("stops at an ancestor the viewer cannot see", () => {
    expect(crumbsFor([item("b", "Beta", "hidden")], "b")).toEqual([{ id: "b", title: "Beta" }]);
  });

  it("does not loop on a cycle", () => {
    expect(crumbsFor([item("a", "A", "b"), item("b", "B", "a")], "a")).toHaveLength(2);
  });

  it("names an untitled folder", () => {
    expect(crumbsFor(scopes[1].items, "x")).toEqual([{ id: "x", title: "Untitled" }]);
  });
});

describe("locationOf", () => {
  it("builds Space › Folder › Folder and points at the containing folder", () => {
    expect(locationOf(scopes[0], "b")).toMatchObject({
      scopeId: "mine",
      scopeLabel: "My Drive",
      folderId: "b",
      path: "My Drive › Alpha › Beta",
    });
  });

  it("is just the space for an item at the top level", () => {
    expect(locationOf(scopes[0], null)).toMatchObject({ folderId: null, folders: [], path: "My Drive" });
  });
});

describe("locateFolder", () => {
  it("finds the space that holds a folder", () => {
    expect(locateFolder(scopes, "c")?.path).toBe("My Drive › Alpha › Beta › Gamma");
  });

  it("returns null for no parent or a folder outside every space", () => {
    expect(locateFolder(scopes, null)).toBeNull();
    expect(locateFolder(scopes, "gone")).toBeNull();
  });
});

describe("LocationLink", () => {
  const render = (location: ReturnType<typeof locationOf> | null) =>
    renderToStaticMarkup(createElement(LocationLink, { location, onNavigate: vi.fn() }));

  it("renders every segment with the full path as its tooltip", () => {
    const html = render(locationOf(scopes[0], "b"));
    expect(html).toContain('data-testid="drive-location"');
    expect(html).toContain('title="My Drive › Alpha › Beta"');
    for (const label of ["My Drive", "Alpha", "Beta"]) expect(html).toContain(label);
    expect(html.match(/lucide-chevron-right/g)).toHaveLength(2);
  });

  it("renders nothing clickable when the location is unknown", () => {
    expect(render(null)).not.toContain("<button");
  });
});

describe("locateItem", () => {
  it("places an item inside its folder chain", () => {
    expect(locateItem(scopes, item("z", "Zed", "b"))).toBeNull();
    expect(locateItem(scopes, scopes[0].items[2])?.path).toBe("My Drive › Alpha › Beta");
  });

  it("places a top-level item at its space", () => {
    const loc = locateItem(scopes, scopes[0].items[3]);
    expect(loc).toMatchObject({ scopeId: "mine", folderId: null, path: "My Drive" });
  });
});
