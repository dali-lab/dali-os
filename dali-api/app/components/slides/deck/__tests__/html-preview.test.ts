import { describe, expect, it } from "vitest";
import { htmlPreviewSize, htmlPreviewUrl, htmlPreviewVersion } from "../html-preview";

describe("htmlPreviewSize", () => {
  it("rounds to whole pixels and keeps within 1 to 3840 by 2160", () => {
    expect(htmlPreviewSize({ w: 960.4, h: 539.6 })).toEqual({ w: 960, h: 540 });
    expect(htmlPreviewSize({ w: 0, h: -5 })).toEqual({ w: 1, h: 1 });
    expect(htmlPreviewSize({ w: 9000, h: 9000 })).toEqual({ w: 3840, h: 2160 });
  });
});

describe("htmlPreviewVersion", () => {
  const base = htmlPreviewVersion("<p>a</p>", "dali-dark", { w: 100, h: 100 });

  it("is a stable 8-character hex string", () => {
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    expect(htmlPreviewVersion("<p>a</p>", "dali-dark", { w: 100, h: 100 })).toBe(base);
  });

  it("changes with the source, the theme and the size", () => {
    expect(htmlPreviewVersion("<p>b</p>", "dali-dark", { w: 100, h: 100 })).not.toBe(base);
    expect(htmlPreviewVersion("<p>a</p>", "dali-light", { w: 100, h: 100 })).not.toBe(base);
    expect(htmlPreviewVersion("<p>a</p>", "dali-dark", { w: 101, h: 100 })).not.toBe(base);
    expect(htmlPreviewVersion("<p>a</p>", "dali-dark", { w: 100, h: 101 })).not.toBe(base);
  });

  it("does not reuse pictures drawn before the frame loaded the theme fonts", () => {
    expect(base).not.toBe("9147a52a");
  });
});

describe("htmlPreviewUrl", () => {
  it("names the deck, the element and the version", () => {
    expect(htmlPreviewUrl("p1", "e/1", "abc")).toBe("/slides/p1/html-preview/e%2F1?v=abc");
  });
});
