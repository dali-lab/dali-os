import { describe, expect, it } from "vitest";
import { BLOCK_PALETTE, blockBase, blockShades, dominantColor, letterInk, paletteFor } from "~/community/lib/block-color";

const px = (...rgba: number[][]) => rgba.flat();

describe("palette", () => {
  it("picks the same palette color for the same name", () => {
    expect(paletteFor("Airbnb")).toBe(paletteFor(" airbnb "));
    expect(BLOCK_PALETTE).toContain(paletteFor("Airbnb"));
  });

  it("uses the given color only when it is a valid hex", () => {
    expect(blockBase("Acme", "#112233")).toBe("#112233");
    expect(blockBase("Acme", "red")).toBe(paletteFor("Acme"));
    expect(blockBase("Acme", null)).toBe(paletteFor("Acme"));
  });

  it("mixes shades toward white and black", () => {
    const s = blockShades("#112233");
    expect(s.face).toBe("#112233");
    expect(s.light).toContain("white");
    expect(s.dark).toContain("black");
  });
});

describe("dominantColor", () => {
  it("returns the most common saturated color", () => {
    const red = [220, 30, 30, 255];
    const blue = [20, 30, 220, 255];
    expect(dominantColor(px(red, red, red, blue))).toBe("#DC1E1E");
  });

  it("ignores white, transparent and gray pixels", () => {
    expect(dominantColor(px([255, 255, 255, 255], [220, 30, 30, 0], [120, 120, 125, 255]))).toBeNull();
  });

  it("returns null for no pixels", () => {
    expect(dominantColor([])).toBeNull();
  });
});

describe("letterInk", () => {
  it("uses dark ink on the light palette colors and white elsewhere", () => {
    expect(letterInk("var(--color-accent-yellow)")).toBe("var(--color-navy-deep)");
    expect(letterInk("var(--color-accent-green)")).toBe("var(--color-navy-deep)");
    expect(letterInk("var(--color-navy)")).toBe("white");
  });
});
