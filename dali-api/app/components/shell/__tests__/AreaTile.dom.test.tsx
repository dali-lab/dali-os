// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AreaTile } from "~/components/shell/AreaTile";
import { AREA_TONES, areaTint, DEFAULT_AREA_TINT } from "~/lib/nav-areas";

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
  it.each(["projects", "community", "education", "hiring", "core", "admin"])(
    "exposes %s's tone pair and paints from the mode-resolved --tile",
    async (key) => {
      const el = await render(key);
      expect(el.style.getPropertyValue("--tile-tint")).toBe(AREA_TONES[key].tint);
      expect(el.style.getPropertyValue("--tile-ink")).toBe(AREA_TONES[key].ink);
      const style = el.getAttribute("style") ?? "";
      expect(style).toContain("color: var(--tile)");
      expect(style).toContain("color-mix(in srgb, var(--tile) 18%, transparent)");
    },
  );

  it("keeps every area tone a plain hex so the wash can derive from it", () => {
    for (const [key, tone] of Object.entries(AREA_TONES)) {
      expect(tone.tint, key).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tone.ink, key).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("keeps Lab and Connect visually distinct", () => {
    expect(AREA_TONES.projects.tint).not.toBe(AREA_TONES.community.tint);
  });

  it("falls back to the neutral tint for unknown areas", () => {
    expect(areaTint("not-an-area")).toBe(DEFAULT_AREA_TINT);
    expect(areaTint(undefined)).toBe(DEFAULT_AREA_TINT);
  });

  it("renders identically whether or not the light theme is on", async () => {
    const dark = (await render("education")).outerHTML;
    act(() => root.unmount());
    container.remove();
    document.documentElement.classList.add("light");
    expect((await render("education")).outerHTML).toBe(dark);
  });

  it("sizes the tile, radius and glyph per size", async () => {
    const el = await render("core", 22);
    expect(el.style.width).toBe("22px");
    expect(el.className).toContain("rounded-[6px]");
    expect(el.querySelector("svg")?.getAttribute("width")).toBe("13");
    act(() => root.unmount());
    container.remove();
    expect((await render("core", 26)).className).toContain("rounded-[7px]");
  });
});
