// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { LocationLink } from "~/components/drive/LocationLink";
import type { ItemLocation } from "~/components/drive/location";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const location: ItemLocation = {
  scopeId: "projects",
  scopeLabel: "Projects",
  folderId: "assets",
  folders: [
    { id: "p1", title: "DALI OS", iconEmoji: "🚀", synthetic: true },
    { id: "plain", title: "Plans" },
    { id: "meet", title: "Meetings", folderType: "Meetings" },
    { id: "assets", title: "Assets", folderType: "Agreements" },
  ],
  path: "Projects › DALI OS › Plans › Meetings › Assets",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(props: Partial<Parameters<typeof LocationLink>[0]> = {}) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(LocationLink, { location, ...props })));
  });
}

const crumbs = () => [...container.querySelectorAll('[data-testid="drive-location-crumb"]')] as HTMLElement[];
const glyphOf = (el: HTMLElement) => el.querySelector('[data-testid^="drive-location-glyph"]')!;

describe("LocationLink", () => {
  it("renders one clickable crumb per space and folder, with no tooltip", () => {
    mount({ onNavigate: vi.fn() });
    expect(crumbs().map((c) => c.textContent)).toEqual(["Projects", "🚀DALI OS", "Plans", "Meetings", "Assets"]);
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("navigates to the space or to the clicked folder", () => {
    const onNavigate = vi.fn();
    mount({ onNavigate });
    act(() => crumbs()[0].click());
    act(() => crumbs()[2].click());
    expect(onNavigate.mock.calls).toEqual([
      ["projects", null],
      ["projects", "plain"],
    ]);
  });

  it("does not let a crumb click reach the row behind it", () => {
    const onRow = vi.fn();
    act(() => {
      root.render(
        createElement(
          "div",
          { onClick: onRow },
          createElement(MemoryRouter, null, createElement(LocationLink, { location, onNavigate: vi.fn() })),
        ),
      );
    });
    act(() => crumbs()[1].click());
    expect(onRow).not.toHaveBeenCalled();
  });

  it("links crumbs by href, and appends the notebook as the last link", () => {
    mount({
      hrefFor: (scope, folder) => `/drive?scope=${scope}${folder ? `&folder=${folder}` : ""}`,
      notebook: { id: "nb", title: "Team notes", href: "/documents/nb" },
    });
    const links = crumbs() as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/drive?scope=projects",
      "/drive?scope=projects&folder=p1",
      "/drive?scope=projects&folder=plain",
      "/drive?scope=projects&folder=meet",
      "/drive?scope=projects&folder=assets",
      "/documents/nb",
    ]);
    expect(links.at(-1)!.textContent).toBe("Team notes");
  });

  it("draws a glyph for each kind of crumb", () => {
    mount({ onNavigate: vi.fn(), notebook: { id: "nb", title: "Team notes", href: "/documents/nb" } });
    const [space, project, plain, meetings, typed, notebook] = crumbs();
    expect(glyphOf(space).querySelector("svg")).toBeTruthy();
    expect(glyphOf(project).textContent).toBe("🚀");
    expect(glyphOf(plain).querySelector("svg.lucide-folder")).toBeTruthy();
    expect(glyphOf(plain).querySelector("svg")!.getAttribute("class")).not.toContain("text-accent-pink");
    expect(glyphOf(typed).querySelector("svg.lucide-folder-cog")!.getAttribute("class")).toContain("text-accent-pink");
    expect(glyphOf(meetings).querySelector("svg.lucide-folder-cog")).toBeTruthy();
    expect(glyphOf(notebook).querySelector("svg.lucide-notebook-pen")).toBeTruthy();
  });

  it("draws a project row without an emoji as the pink system folder", () => {
    mount({
      onNavigate: vi.fn(),
      location: { ...location, folders: [{ id: "p2", title: "Atlas", synthetic: true }] },
    });
    expect(glyphOf(crumbs()[1]).querySelector("svg.lucide-folder-cog")).toBeTruthy();
  });

  it("renders nothing clickable for an unknown location", () => {
    mount({ location: null });
    expect(crumbs()).toHaveLength(0);
  });
});
