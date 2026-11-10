import type { Area } from "react-easy-crop";

export type Rect = { x: number; y: number; width: number; height: number };
export type EdgeColors = { top: string; bottom: string; left: string; right: string };

/** The zoom at which the whole image sits inside a crop box of `aspect`. */
export function fitZoom(imageWidth: number, imageHeight: number, aspect: number): number {
  const a = imageWidth / imageHeight;
  return Math.min(a / aspect, aspect / a);
}

/**
 * Where the image lands on a `width`×`height` output for a crop `area` that
 * may reach past the image, and the bands left around it to fill.
 */
export function fitLayout(area: Area, imageWidth: number, imageHeight: number, width: number, height: number) {
  const scale = width / area.width;
  const image: Rect = {
    x: 0 - area.x * scale,
    y: 0 - area.y * scale,
    width: imageWidth * scale,
    height: imageHeight * scale,
  };
  const top = Math.max(0, Math.min(height, image.y));
  const bottom = Math.max(top, Math.min(height, image.y + image.height));
  const left = Math.max(0, Math.min(width, image.x));
  const right = Math.max(left, Math.min(width, image.x + image.width));
  const bands: Record<keyof EdgeColors, Rect | null> = {
    top: top > 0 ? { x: 0, y: 0, width, height: top } : null,
    bottom: bottom < height ? { x: 0, y: bottom, width, height: height - bottom } : null,
    left: left > 0 ? { x: 0, y: top, width: left, height: bottom - top } : null,
    right: right < width ? { x: right, y: top, width: width - right, height: bottom - top } : null,
  };
  return { image, bands };
}

/** Average color of each outer row and column of RGBA pixel data. */
export function edgeColors(data: Uint8ClampedArray, width: number, height: number): EdgeColors {
  const avg = (pixels: number[]) => {
    const sum = [0, 0, 0];
    for (const p of pixels) for (let c = 0; c < 3; c++) sum[c] += data[p * 4 + c];
    const [r, g, b] = sum.map((s) => Math.round(s / pixels.length));
    return `rgb(${r}, ${g}, ${b})`;
  };
  const row = (y: number) => Array.from({ length: width }, (_, x) => y * width + x);
  const col = (x: number) => Array.from({ length: height }, (_, y) => y * width + x);
  return { top: avg(row(0)), bottom: avg(row(height - 1)), left: avg(col(0)), right: avg(col(width - 1)) };
}

/** A two-tone backdrop for the crop box that matches the fill the saved image gets. */
export function fitBackdrop(colors: EdgeColors, imageAspect: number, aspect: number): string {
  return imageAspect > aspect
    ? `linear-gradient(to bottom, ${colors.top} 50%, ${colors.bottom} 50%)`
    : `linear-gradient(to right, ${colors.left} 50%, ${colors.right} 50%)`;
}
