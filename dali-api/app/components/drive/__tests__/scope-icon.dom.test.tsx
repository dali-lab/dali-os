// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { scopeIconFor } from "~/components/drive/scope-icon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(id: string, tiles?: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement("div", null, scopeIconFor({ id }, "sm", tiles)));
  });
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("scopeIconFor tiles", () => {
  it.each([
    ["lab", "projects"],
    ["projects", "projects"],
    ["mentorship", "projects"],
    ["education", "education"],
    ["hiring", "hiring"],
    ["core", "core"],
  ])("renders the %s space as the %s area tile", async (id, area) => {
    const c = await render(id, true);
    expect(c.querySelector(`[data-area-tile='${area}']`)).not.toBeNull();
  });

  it("keeps each space's own glyph inside its area's tile", async () => {
    const mentorship = (await render("mentorship", true)).innerHTML;
    act(() => root.unmount());
    container.remove();
    const projects = (await render("projects", true)).innerHTML;
    act(() => root.unmount());
    container.remove();
    const lab = (await render("lab", true)).innerHTML;
    expect(mentorship).toContain("lucide-heart");
    expect(projects).toContain("lucide-folder-kanban");
    expect(lab).toContain("lucide-users");
  });

  it.each(["mine", "favorites", "shared"])("keeps %s a plain glyph", async (id) => {
    const c = await render(id, true);
    expect(c.querySelector("[data-area-tile]")).toBeNull();
    expect(c.querySelector("svg")).not.toBeNull();
  });

  it("keeps today's glyphs when tiles are off", async () => {
    const c = await render("core");
    expect(c.querySelector("[data-area-tile]")).toBeNull();
    expect(c.querySelector("svg")!.getAttribute("class")).toContain("text-accent-coral/80");
  });
});
