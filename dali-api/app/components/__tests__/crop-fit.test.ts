import { describe, expect, it } from "vitest";
import { edgeColors, fitBackdrop, fitLayout, fitZoom } from "~/components/crop-fit";

describe("fitZoom", () => {
  it("zooms a wide image out until its full width sits in a tall frame", () => {
    expect(fitZoom(1200, 1000, 3 / 4)).toBeCloseTo((3 / 4) / 1.2);
  });

  it("zooms a tall image out until its full height sits in a wide frame", () => {
    expect(fitZoom(900, 1600, 16 / 9)).toBeCloseTo(0.5625 / (16 / 9));
  });

  it("is 1 when the image already has the frame's shape", () => {
    expect(fitZoom(1080, 1440, 3 / 4)).toBeCloseTo(1);
  });
});

describe("fitLayout", () => {
  it("places an in-bounds crop like a plain crop, with nothing to fill", () => {
    const { image, bands } = fitLayout({ x: 100, y: 50, width: 300, height: 400 }, 1000, 1000, 600, 800);
    expect(image).toEqual({ x: -200, y: -100, width: 2000, height: 2000 });
    expect(bands).toEqual({ top: null, bottom: null, left: null, right: null });
  });

  it("centers a wide image in a tall frame with bands above and below", () => {
    // 1200x1000 image fit to 3:4: crop is 1200 wide, 1600 tall, starting 300 above the image.
    const { image, bands } = fitLayout({ x: 0, y: -300, width: 1200, height: 1600 }, 1200, 1000, 1080, 1440);
    expect(image).toEqual({ x: 0, y: 270, width: 1080, height: 900 });
    expect(bands.top).toEqual({ x: 0, y: 0, width: 1080, height: 270 });
    expect(bands.bottom).toEqual({ x: 0, y: 1170, width: 1080, height: 270 });
    expect(bands.left).toBeNull();
    expect(bands.right).toBeNull();
  });

  it("fills the sides when a tall image sits in a wide frame", () => {
    const { bands } = fitLayout({ x: -50, y: 0, width: 200, height: 100 }, 100, 100, 400, 200);
    expect(bands.left).toEqual({ x: 0, y: 0, width: 100, height: 200 });
    expect(bands.right).toEqual({ x: 300, y: 0, width: 100, height: 200 });
    expect(bands.top).toBeNull();
    expect(bands.bottom).toBeNull();
  });
});

describe("edgeColors", () => {
  it("averages each outer row and column", () => {
    // 2x2: white top row, green bottom row.
    const data = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 0, 100, 0, 255, 0, 100, 0, 255]);
    expect(edgeColors(data, 2, 2)).toEqual({
      top: "rgb(255, 255, 255)",
      bottom: "rgb(0, 100, 0)",
      left: "rgb(128, 178, 128)",
      right: "rgb(128, 178, 128)",
    });
  });
});

describe("fitBackdrop", () => {
  const colors = { top: "t", bottom: "b", left: "l", right: "r" };
  it("splits top and bottom when the image is wider than the frame", () => {
    expect(fitBackdrop(colors, 1.2, 3 / 4)).toBe("linear-gradient(to bottom, t 50%, b 50%)");
  });
  it("splits left and right when the image is taller than the frame", () => {
    expect(fitBackdrop(colors, 0.5, 16 / 9)).toBe("linear-gradient(to right, l 50%, r 50%)");
  });
});
