import { isBlockColor } from "~/community/lib/opportunities";

export const BLOCK_PALETTE = [
  "var(--color-accent-teal)",
  "var(--color-accent-yellow)",
  "var(--color-accent-coral)",
  "var(--color-navy)",
  "var(--color-accent-pink)",
  "var(--color-accent-green)",
] as const;

export function hashName(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

export function paletteFor(name: string): string {
  return BLOCK_PALETTE[hashName(name) % BLOCK_PALETTE.length];
}

export function blockBase(name: string, color?: string | null): string {
  return color && isBlockColor(color) ? color : paletteFor(name);
}

const LIGHT_PALETTE: readonly string[] = ["var(--color-accent-yellow)", "var(--color-accent-green)"];

export function letterInk(base: string): string {
  return LIGHT_PALETTE.includes(base) ? "var(--color-navy-deep)" : "white";
}

export function blockShades(base: string): { light: string; face: string; dark: string } {
  return {
    light: `color-mix(in srgb, ${base} 62%, white)`,
    face: base,
    dark: `color-mix(in srgb, ${base} 68%, black)`,
  };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

export function dominantColor(pixels: ArrayLike<number>): string | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 128) continue;
    if (r > 235 && g > 235 && b > 235) continue;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return null;
  return `#${hex2(best.r / best.n)}${hex2(best.g / best.n)}${hex2(best.b / best.n)}`.toUpperCase();
}

export function readLogoColor(img: HTMLImageElement): string | null {
  try {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return dominantColor(ctx.getImageData(0, 0, size, size).data);
  } catch {
    return null;
  }
}
