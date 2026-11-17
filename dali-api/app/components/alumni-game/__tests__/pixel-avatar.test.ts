import { describe, it, expect } from "vitest";
import {
  SKIN_TONES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIRSTYLES,
  DEFAULT_AVATAR,
  isAvatarConfig,
  avatarPaletteMap,
  swapPalette,
  hexToRgb,
  findEyeRects,
  type AvatarConfig,
} from "../pixel-avatar";

describe("catalogs", () => {
  it("has unique keys per catalog", () => {
    for (const catalog of [SKIN_TONES, EYE_COLORS, HAIR_COLORS, HAIRSTYLES] as const) {
      const keys = catalog.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it("names a distinct sheet per hairstyle", () => {
    const assets = HAIRSTYLES.map((h) => h.asset);
    expect(new Set(assets).size).toBe(assets.length);
  });

  it("accepts the default config", () => {
    expect(isAvatarConfig(DEFAULT_AVATAR)).toBe(true);
  });
});

describe("isAvatarConfig", () => {
  it("accepts every catalog value in each slot", () => {
    for (const s of SKIN_TONES) expect(isAvatarConfig({ ...DEFAULT_AVATAR, skinTone: s.key })).toBe(true);
    for (const e of EYE_COLORS) expect(isAvatarConfig({ ...DEFAULT_AVATAR, eyeColor: e.key })).toBe(true);
    for (const h of HAIR_COLORS) expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairColor: h.key })).toBe(true);
    for (const h of HAIRSTYLES) expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairstyle: h.key })).toBe(true);
  });

  it("accepts a custom hex in each color slot, but not for hairstyle", () => {
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, skinTone: "#8a5a33" })).toBe(true);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, eyeColor: "#FF8800" })).toBe(true);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairColor: "#123abc" })).toBe(true);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairstyle: "#123abc" })).toBe(false);
  });

  it("rejects unknown values, malformed hex, missing fields and non-objects", () => {
    expect(isAvatarConfig(null)).toBe(false);
    expect(isAvatarConfig("fair")).toBe(false);
    expect(isAvatarConfig({ skinTone: "fair", eyeColor: "brown", hairstyle: "short" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, skinTone: "neon" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, skinTone: "#12345" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, skinTone: "#12345g" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, eyeColor: "laser" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairColor: "laser" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, hairstyle: "mohawk" })).toBe(false);
  });
});

describe("avatarPaletteMap", () => {
  const config: AvatarConfig = {
    skinTone: "deep",
    eyeColor: "blue",
    hairColor: "blonde",
    hairstyle: "bun",
  };

  it("maps the sheet's skin, hand and iris grays to the chosen colors", () => {
    const map = avatarPaletteMap(config);
    const tone = SKIN_TONES.find((s) => s.key === "deep")!;
    const eye = EYE_COLORS.find((e) => e.key === "blue")!;
    expect(map["183,181,178"]).toEqual(hexToRgb(tone.base));
    expect(map["141,136,131"]).toEqual(hexToRgb(tone.shade));
    expect(map["210,210,210"]).toEqual(hexToRgb(tone.base));
    expect(map["69,66,66"]).toEqual(hexToRgb(eye.dark));
    expect(map["91,91,91"]).toEqual(hexToRgb(eye.light));
  });

  it("tints the hair grays from the chosen hair color, outline darker than base", () => {
    const map = avatarPaletteMap(config);
    expect(map["52,52,52"]).toEqual(hexToRgb(HAIR_COLORS.find((h) => h.key === "blonde")!.base));
    const outline = map["33,31,31"];
    expect(outline[0]).toBeLessThan(map["52,52,52"][0]);
    expect(map["20,20,20"][0]).toBeLessThan(outline[0]);
  });

  it("softens the eye whites toward the skin tone instead of pure white", () => {
    const deep = avatarPaletteMap(config)["244,243,243"];
    const fair = avatarPaletteMap({ ...config, skinTone: "fair" })["244,243,243"];
    // Darker skin gets a dimmer, warmer sclera; never pure white.
    expect(deep[0]).toBeLessThan(fair[0]);
    expect(deep[0]).toBeLessThan(255);
    expect(deep[0]).toBeGreaterThan(deep[2]);
    const shade = avatarPaletteMap(config)["223,220,220"];
    expect(shade[0]).toBeLessThan(deep[0]);
  });

  it("darkens the mouth from the skin base", () => {
    const map = avatarPaletteMap(config);
    const base = hexToRgb(SKIN_TONES.find((s) => s.key === "deep")!.base);
    expect(map["102,102,102"][0]).toBeLessThan(base[0]);
  });

  it("leaves the sweater's fold shading alone", () => {
    expect(avatarPaletteMap(config)["206,205,205"]).toBeUndefined();
  });

  it("resolves custom hex colors in every slot", () => {
    const map = avatarPaletteMap({
      skinTone: "#8a5a33",
      eyeColor: "#ff8800",
      hairColor: "#123abc",
      hairstyle: "short",
    });
    expect(map["183,181,178"]).toEqual([0x8a, 0x5a, 0x33]);
    expect(map["91,91,91"]).toEqual([0xff, 0x88, 0x00]);
    expect(map["69,66,66"][0]).toBeLessThan(0xff);
    expect(map["52,52,52"]).toEqual([0x12, 0x3a, 0xbc]);
    const shade = map["141,136,131"];
    expect(shade[0]).toBeLessThan(0x8a);
  });

  it("falls back to defaults for retired stored keys", () => {
    const map = avatarPaletteMap({
      skinTone: "retired",
      eyeColor: "retired",
      hairColor: "retired",
      hairstyle: "short",
    } as never);
    expect(map["183,181,178"]).toEqual(hexToRgb(SKIN_TONES[1].base));
    expect(map["69,66,66"]).toEqual(hexToRgb(EYE_COLORS[0].dark));
    expect(map["52,52,52"]).toEqual(hexToRgb(HAIR_COLORS[0].base));
  });
});

describe("swapPalette", () => {
  it("replaces mapped colors, leaves others and alpha alone", () => {
    // Three pixels: skin gray, outline black, transparent skin gray.
    const data = new Uint8ClampedArray([
      183, 181, 178, 255,
      0, 0, 0, 255,
      183, 181, 178, 0,
    ]);
    swapPalette(data, { "183,181,178": [10, 20, 30] });
    expect([...data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...data.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...data.slice(8, 12)]).toEqual([183, 181, 178, 0]);
  });
});

describe("findEyeRects", () => {
  it("boxes the iris and sclera grays into a left and a right eye", () => {
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, rgb: [number, number, number]) => {
      const i = (y * w + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    };
    // Left eye: iris + sclera across (2-4, 3-4). Right eye at (14-15, 3).
    put(2, 3, [69, 66, 66]);
    put(3, 3, [91, 91, 91]);
    put(4, 4, [244, 243, 243]);
    put(14, 3, [223, 220, 220]);
    put(15, 3, [69, 66, 66]);
    // Skin and outline noise that must not join the boxes.
    put(8, 8, [183, 181, 178]);
    put(0, 0, [0, 0, 0]);
    const rects = findEyeRects(data, w, h);
    expect(rects).toEqual([
      { x: 2, y: 3, w: 3, h: 2 },
      { x: 14, y: 3, w: 2, h: 1 },
    ]);
  });

  it("returns nothing when no eye grays exist", () => {
    expect(findEyeRects(new Uint8ClampedArray(16), 2, 2)).toEqual([]);
  });
});

describe("hexToRgb", () => {
  it("parses hex colors", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#0a1b2c")).toEqual([10, 27, 44]);
  });
});
