// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AreaTile } from "~/components/shell/AreaTile";
import { AREA_TONES } from "~/lib/nav-areas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(key: string, size: 20 | 22 | 26 = 26) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AreaTile, { areaKey: key, size }));
  });
  return container.querySelector(`[data-area-tile='${key}']`) as HTMLElement;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.classList.remove("light");
});

describe("AreaTile", () => {
  it.each([
    ["projects", "rgb(30, 87, 121)", "rgb(255, 255, 255)"],
    ["community", "rgb(0, 173, 171)", "rgb(255, 255, 255)"],
    ["education", "rgb(255, 212, 97)", "rgb(21, 58, 82)"],
    ["core", "rgb(255, 139, 129)", "rgb(21, 58, 82)"],
  ])("paints %s with its tile and glyph colors", async (key, bg, fg) => {
    const el = await render(key);
    expect(el.style.backgroundColor).toBe(bg);
    expect(el.style.color).toBe(fg);
  });

  it("paints Hiring with the yellow to coral gradient", async () => {
    const el = await render("hiring");
    expect(el.style.background).toContain("linear-gradient");
    expect(AREA_TONES.hiring.tile).toBe("linear-gradient(135deg, #FFD461, #FF8B81)");
  });

  it("outlines Admin on a transparent tile", async () => {
    const el = await render("admin");
    expect(el.style.border).toContain("1px solid");
    expect(AREA_TONES.admin.tile).toBe("transparent");
  });

  it("gives only Lab the dark hairline", async () => {
    expect((await render("projects")).className).toContain("area-tile-ring");
    act(() => root.unmount());
    container.remove();
    expect((await render("core")).className).not.toContain("area-tile-ring");
  });

  it("renders identically whether or not the light theme is on", async () => {
    const dark = (await render("education")).outerHTML;
    act(() => root.unmount());
    container.remove();
    document.documentElement.classList.add("light");
    expect((await render("education")).outerHTML).toBe(dark);
  });

  it("sizes the tile and radius per size", async () => {
    const el = await render("core", 22);
    expect(el.style.width).toBe("22px");
    expect(el.className).toContain("rounded-[6px]");
    act(() => root.unmount());
    container.remove();
    expect((await render("core", 26)).className).toContain("rounded-[7px]");
  });
});
