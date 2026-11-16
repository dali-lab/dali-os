// The pixel avatar is composited from Sophie's sprite sheets in
// app/assets/alumni-lab/avatar/: a base body whose skin and irises are
// painted in known flat grays, plus one hair layer per style. Tinting is an
// exact palette swap on those grays, so the art stays untouched and any skin
// or eye color works. Catalog keys are the contract stored on PixelAvatar.

export const SKIN_TONES = [
  { key: "porcelain", label: "Porcelain", base: "#f8dcc8", shade: "#e0bda3" },
  { key: "fair", label: "Fair", base: "#f1c9a5", shade: "#d8a87e" },
  { key: "tan", label: "Tan", base: "#dfa97c", shade: "#c08a5c" },
  { key: "olive", label: "Olive", base: "#c48e5c", shade: "#a26f41" },
  { key: "brown", label: "Brown", base: "#9c6b3f", shade: "#7c5230" },
  { key: "deep", label: "Deep", base: "#6e4428", shade: "#54311c" },
] as const;

export const EYE_COLORS = [
  { key: "brown", label: "Brown", dark: "#4a2e1b", light: "#7a4e2e" },
  { key: "hazel", label: "Hazel", dark: "#5c4a1e", light: "#8f7639" },
  { key: "green", label: "Green", dark: "#2f5a2e", light: "#4f8a4b" },
  { key: "blue", label: "Blue", dark: "#28507f", light: "#4a7cb5" },
  { key: "gray", label: "Gray", dark: "#4c525c", light: "#7d8591" },
  { key: "amber", label: "Amber", dark: "#7a4e12", light: "#b57a24" },
] as const;

export const HAIR_COLORS = [
  { key: "black", label: "Black", base: "#35353a" },
  { key: "brown", label: "Brown", base: "#5d4030" },
  { key: "chestnut", label: "Chestnut", base: "#7b4f2e" },
  { key: "blonde", label: "Blonde", base: "#c79a52" },
  { key: "auburn", label: "Auburn", base: "#8a3f26" },
  { key: "silver", label: "Silver", base: "#a2a2a8" },
] as const;

export const HAIRSTYLES = [
  { key: "short", label: "Short", asset: "hair-1" },
  { key: "bob", label: "Bob", asset: "hair-2" },
  { key: "wavy", label: "Wavy", asset: "hair-3" },
  { key: "bangs", label: "Bangs", asset: "hair-4" },
  { key: "messy", label: "Messy", asset: "hair-5" },
  { key: "longbob", label: "Long bob", asset: "hair-6" },
  { key: "sideswept", label: "Side swept", asset: "hair-7" },
  { key: "bun", label: "Bun", asset: "hair-8" },
  { key: "curls", label: "Curls", asset: "hair-9" },
] as const;

export type SkinToneKey = (typeof SKIN_TONES)[number]["key"];
export type EyeColorKey = (typeof EYE_COLORS)[number]["key"];
export type HairColorKey = (typeof HAIR_COLORS)[number]["key"];
export type HairstyleKey = (typeof HAIRSTYLES)[number]["key"];

// Each color is a catalog key or a custom "#rrggbb" the member picked.
export type AvatarConfig = {
  skinTone: string;
  eyeColor: string;
  hairColor: string;
  hairstyle: HairstyleKey;
};

export const DEFAULT_AVATAR: AvatarConfig = {
  skinTone: "fair",
  eyeColor: "brown",
  hairColor: "black",
  hairstyle: "bob",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isColorValue(catalog: readonly { key: string }[], v: unknown): v is string {
  return typeof v === "string" && (catalog.some((c) => c.key === v) || HEX_COLOR.test(v));
}

export function isAvatarConfig(value: unknown): value is AvatarConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isColorValue(SKIN_TONES, v.skinTone) &&
    isColorValue(EYE_COLORS, v.eyeColor) &&
    isColorValue(HAIR_COLORS, v.hairColor) &&
    HAIRSTYLES.some((h) => h.key === v.hairstyle)
  );
}

// The sheets are 1600x2500 drawn in 25px blocks; the repo copies are 1/5 size.
export const SPRITE = { width: 320, height: 500 } as const;

// Exact grays painted in the sheets. Hands (and the ear highlight) use their
// own gray, distinct from the sweater's fold shading at (206,205,205). The
// sclera grays are remapped relative to the skin tone so eye whites don't
// glare against darker skin. Hair sheets shade with the SRC_HAIR_* grays.
const SRC_SKIN = "183,181,178";
const SRC_SKIN_SHADE = "141,136,131";
const SRC_HAND = "210,210,210";
const SRC_MOUTH = "102,102,102";
const SRC_IRIS_DARK = "69,66,66";
const SRC_IRIS_LIGHT = "91,91,91";
const SRC_SCLERA = "244,243,243";
const SRC_SCLERA_SHADE = "223,220,220";
const SRC_HAIR = [
  ["52,52,52", 1],
  ["33,31,31", 0.62],
  ["30,28,28", 0.56],
  ["28,27,27", 0.53],
  ["20,20,20", 0.38],
] as const;

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function darken([r, g, b]: Rgb, factor: number): Rgb {
  return [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];
}

function toward([r, g, b]: Rgb, [tr, tg, tb]: Rgb, t: number): Rgb {
  return [
    Math.round(r + (tr - r) * t),
    Math.round(g + (tg - g) * t),
    Math.round(b + (tb - b) * t),
  ];
}

const WHITE: Rgb = [255, 255, 255];

// A stored color is a catalog key or a custom hex; unknown stored keys fall
// back to the default entry so an old row still renders.
export function resolveSkin(value: string): { base: Rgb; shade: Rgb } {
  if (HEX_COLOR.test(value)) {
    const base = hexToRgb(value);
    return { base, shade: darken(base, 0.8) };
  }
  const tone = SKIN_TONES.find((s) => s.key === value) ?? SKIN_TONES[1];
  return { base: hexToRgb(tone.base), shade: hexToRgb(tone.shade) };
}

export function resolveEye(value: string): { dark: Rgb; light: Rgb } {
  if (HEX_COLOR.test(value)) {
    const light = hexToRgb(value);
    return { light, dark: darken(light, 0.62) };
  }
  const eye = EYE_COLORS.find((e) => e.key === value) ?? EYE_COLORS[0];
  return { dark: hexToRgb(eye.dark), light: hexToRgb(eye.light) };
}

export function resolveHair(value: string): Rgb {
  if (HEX_COLOR.test(value)) return hexToRgb(value);
  return hexToRgb((HAIR_COLORS.find((h) => h.key === value) ?? HAIR_COLORS[0]).base);
}

// Source color -> replacement, keyed "r,g,b".
export function avatarPaletteMap(config: AvatarConfig): Record<string, Rgb> {
  const skin = resolveSkin(config.skinTone);
  const eye = resolveEye(config.eyeColor);
  const hair = resolveHair(config.hairColor);
  const map: Record<string, Rgb> = {
    [SRC_SKIN]: skin.base,
    [SRC_SKIN_SHADE]: skin.shade,
    [SRC_HAND]: skin.base,
    [SRC_MOUTH]: darken(skin.base, 0.55),
    [SRC_IRIS_DARK]: eye.dark,
    [SRC_IRIS_LIGHT]: eye.light,
    [SRC_SCLERA]: toward(skin.base, WHITE, 0.78),
    [SRC_SCLERA_SHADE]: toward(skin.base, WHITE, 0.6),
  };
  for (const [src, factor] of SRC_HAIR) map[src] = darken(hair, factor);
  return map;
}

// In-place exact-match palette swap over RGBA bytes. Transparent pixels and
// colors outside the map are untouched.
export function swapPalette(data: Uint8ClampedArray, map: Record<string, Rgb>) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const target = map[`${data[i]},${data[i + 1]},${data[i + 2]}`];
    if (target) {
      data[i] = target[0];
      data[i + 1] = target[1];
      data[i + 2] = target[2];
    }
  }
}

export type AvatarAssets = { base: string; hair: Record<string, string> };

// Open- and closed-eye variants of the same composited sprite; the scene
// swaps them to blink.
export type AvatarSprites = {
  open: HTMLCanvasElement;
  closed: HTMLCanvasElement;
};

// Content geometry inside the 320x500 frame: the sheets carry wide transparent
// margins, so the scene crops to this box and scales by body height (hair can
// poke above it). Feet sit at the crop's bottom edge.
export const SPRITE_VIEW = { x: 30, y: 45, w: 260, h: 345, bodyTop: 80, feetY: 390 } as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const EYE_SOURCE_COLORS = new Set(["69,66,66", "91,91,91", "244,243,243", "223,220,220"]);

// Finds the two eye bounding boxes from the untinted base's known grays,
// split left/right of the sprite's center line.
export function findEyeRects(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number }[] {
  const boxes = [
    { minX: width, minY: height, maxX: -1, maxY: -1 },
    { minX: width, minY: height, maxX: -1, maxY: -1 },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      if (!EYE_SOURCE_COLORS.has(`${data[i]},${data[i + 1]},${data[i + 2]}`)) continue;
      const b = boxes[x < width / 2 ? 0 : 1];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return boxes
    .filter((b) => b.maxX >= 0)
    .map((b) => ({ x: b.minX, y: b.minY, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1 }));
}

function tintedLayer(
  img: HTMLImageElement,
  map: Record<string, Rgb>,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE.width;
  canvas.height = SPRITE.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, SPRITE.width, SPRITE.height);
  const image = ctx.getImageData(0, 0, SPRITE.width, SPRITE.height);
  swapPalette(image.data, map);
  ctx.putImageData(image, 0, 0);
  return { canvas, ctx };
}

// Builds the tinted, hair-composited sprites for a config. Closed eyes are
// painted on the base before the hair lands, so bangs stay intact.
export async function buildAvatarSprite(
  config: AvatarConfig,
  assets: AvatarAssets,
): Promise<AvatarSprites> {
  const style = HAIRSTYLES.find((h) => h.key === config.hairstyle) ?? HAIRSTYLES[0];
  const [baseImg, hairImg] = await Promise.all([
    loadImage(assets.base),
    loadImage(assets.hair[style.asset]),
  ]);
  const map = avatarPaletteMap(config);
  const skin = resolveSkin(config.skinTone);

  // Eye boxes come from the untinted base.
  const probe = document.createElement("canvas");
  probe.width = SPRITE.width;
  probe.height = SPRITE.height;
  const probeCtx = probe.getContext("2d")!;
  probeCtx.drawImage(baseImg, 0, 0, SPRITE.width, SPRITE.height);
  const eyes = findEyeRects(
    probeCtx.getImageData(0, 0, SPRITE.width, SPRITE.height).data,
    SPRITE.width,
    SPRITE.height,
  );

  const open = tintedLayer(baseImg, map);
  const closed = tintedLayer(baseImg, map);
  const lash = darken(skin.base, 0.45);
  for (const eye of eyes) {
    closed.ctx.fillStyle = `rgb(${skin.base[0]},${skin.base[1]},${skin.base[2]})`;
    closed.ctx.fillRect(eye.x, eye.y, eye.w, eye.h);
    closed.ctx.fillStyle = `rgb(${lash[0]},${lash[1]},${lash[2]})`;
    closed.ctx.fillRect(eye.x, eye.y + eye.h - 5, eye.w, 5);
  }

  const hair = tintedLayer(hairImg, map);
  open.ctx.drawImage(hair.canvas, 0, 0);
  closed.ctx.drawImage(hair.canvas, 0, 0);
  return { open: open.canvas, closed: closed.canvas };
}
