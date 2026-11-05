import { describe, expect, it } from "vitest";
import { LAYOUTS, STAGE_H, STAGE_W, layoutById, layoutFromLegacy } from "../layouts";
import { TEXT_STYLE_IDS, THEMES, themeById, themeVars } from "../themes";

describe("themes", () => {
  it("ships DALI Dark and DALI Light", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["dali-dark", "dali-light"]);
  });

  it("falls back to DALI Dark for an unknown theme id", () => {
    expect(themeById("nope").id).toBe("dali-dark");
  });

  it("emits every --slide-* var and only those", () => {
    for (const theme of THEMES) {
      const vars = themeVars(theme);
      expect(Object.keys(vars).every((k) => k.startsWith("--slide-"))).toBe(true);
      for (const key of ["ground", "surface", "fg", "muted", "accent", "rule", "font-display", "font-body"]) {
        expect(vars[`--slide-${key}`]).toBeTruthy();
      }
      for (const id of TEXT_STYLE_IDS) expect(vars[`--slide-${id}-size`]).toMatch(/^calc\(\d+ \* var\(--slide-u\)\)$/);
    }
  });

  it("dark theme is a navy ground with a coral accent and the display face", () => {
    const vars = themeVars(themeById("dali-dark"));
    expect(vars["--slide-ground"]).toContain("navy-deep");
    expect(vars["--slide-accent"]).toContain("accent-coral");
    expect(vars["--slide-font-display"]).toContain("font-os-logo");
  });

  it("never reaches for os or semantic app tokens", () => {
    for (const theme of THEMES) {
      const all = Object.values(themeVars(theme)).join(" ");
      expect(all).not.toMatch(/--color-(os-|background|foreground|card|muted|border|primary)/);
    }
  });
});

describe("layouts", () => {
  it("has the six layouts", () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(["title", "content", "split", "image", "section", "bignumber"]);
  });

  it("keeps every slot inside the 1920 by 1080 stage", () => {
    for (const layout of LAYOUTS) {
      for (const { rect } of layout.slots) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(STAGE_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("only uses slot names the legacy projection reads", () => {
    const names = new Set(LAYOUTS.flatMap((l) => l.slots.map((s) => s.slot)));
    expect([...names].sort()).toEqual(["body", "image", "subtitle", "title"]);
  });

  it("keeps the four legacy layout ids and maps anything else to content", () => {
    for (const id of ["title", "content", "split", "image"]) expect(layoutFromLegacy(id)).toBe(id);
    expect(layoutFromLegacy("two-column")).toBe("content");
    expect(layoutById("two-column").id).toBe("content");
  });
});
