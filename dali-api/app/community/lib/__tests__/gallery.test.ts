import { describe, it, expect } from "vitest";
import {
  GALLERY_CAPTION_MAX,
  GALLERY_MAX_PHOTOS,
  galleryByline,
  galleryColumnCount,
  galleryDownloadName,
  galleryFeedHref,
  galleryKeyPrefix,
  isGalleryEmoji,
  isGalleryImageKey,
  layoutMasonry,
  parseNewPosts,
  toggleReaction,
  encodeGalleryThumb,
} from "../gallery";

const UUID = "0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10";
const key = (userId = "u1", name = "photo.jpg") => `uploads/gallery/${userId}/${UUID}-${name}`;
const row = (over: Record<string, unknown> = {}) => ({
  imageKey: key(),
  width: 1200,
  height: 800,
  color: "#AABBCC",
  caption: "  Demo day  ",
  ...over,
});

describe("isGalleryImageKey", () => {
  it("accepts the key uploadFileToS3 mints under the poster's prefix", () => {
    expect(galleryKeyPrefix("u1")).toBe("gallery/u1");
    expect(isGalleryImageKey(key(), "u1")).toBe(true);
  });

  it("rejects someone else's upload", () => {
    expect(isGalleryImageKey(key("u2"), "u1")).toBe(false);
  });

  it("rejects keys outside the gallery or with path tricks", () => {
    expect(isGalleryImageKey(`uploads/avatars/u1/${UUID}-a.png`, "u1")).toBe(false);
    expect(isGalleryImageKey(`uploads/gallery/u1/../payroll/${UUID}-a.png`, "u1")).toBe(false);
    expect(isGalleryImageKey(`uploads/gallery/u1/${UUID}-a/b.png`, "u1")).toBe(false);
    expect(isGalleryImageKey("uploads/gallery/u1/not-a-uuid-a.png", "u1")).toBe(false);
  });
});

describe("parseNewPosts", () => {
  it("trims captions, lowercases colours and keeps composer order", () => {
    const posts = parseNewPosts(JSON.stringify([row(), row({ caption: "", width: 10 })]), "u1");
    expect(posts).toEqual([
      { imageKey: key(), thumbKey: null, width: 1200, height: 800, color: "#aabbcc", caption: "Demo day" },
      { imageKey: key(), thumbKey: null, width: 10, height: 800, color: "#aabbcc", caption: null },
    ]);
  });

  it("keeps the poster's own thumbnail key", () => {
    const thumb = key("u1", "thumb.webp");
    expect(parseNewPosts(JSON.stringify([row({ thumbKey: thumb })]), "u1")?.[0].thumbKey).toBe(thumb);
  });

  it("treats a missing caption as none", () => {
    expect(parseNewPosts(JSON.stringify([row({ caption: undefined })]), "u1")?.[0].caption).toBeNull();
  });

  it.each([
    ["not JSON", "{"],
    ["an empty list", "[]"],
    ["an object", JSON.stringify(row())],
    ["a foreign key", JSON.stringify([row({ imageKey: key("u2") })])],
    ["a foreign thumbnail", JSON.stringify([row({ thumbKey: key("u2", "thumb.webp") })])],
    ["a numeric thumbnail", JSON.stringify([row({ thumbKey: 7 })])],
    ["a zero width", JSON.stringify([row({ width: 0 })])],
    ["a fractional height", JSON.stringify([row({ height: 1.5 })])],
    ["a huge side", JSON.stringify([row({ width: 20_001 })])],
    ["a named colour", JSON.stringify([row({ color: "red" })])],
    ["a numeric caption", JSON.stringify([row({ caption: 5 })])],
    ["a long caption", JSON.stringify([row({ caption: "x".repeat(GALLERY_CAPTION_MAX + 1) })])],
    ["too many photos", JSON.stringify(Array.from({ length: GALLERY_MAX_PHOTOS + 1 }, () => row()))],
  ])("rejects %s", (_, raw) => {
    expect(parseNewPosts(raw, "u1")).toBeNull();
  });

  it("rejects the whole batch when one row is bad", () => {
    expect(parseNewPosts(JSON.stringify([row(), row({ color: "#12" })]), "u1")).toBeNull();
  });

  it("accepts the maximum batch", () => {
    const raw = JSON.stringify(Array.from({ length: GALLERY_MAX_PHOTOS }, () => row()));
    expect(parseNewPosts(raw, "u1")).toHaveLength(GALLERY_MAX_PHOTOS);
  });
});

describe("galleryByline", () => {
  it("adds a two-digit class year", () => {
    expect(galleryByline("Maya Chen", 2026)).toBe("Maya Chen '26");
    expect(galleryByline("Old Timer", 2005)).toBe("Old Timer '05");
  });

  it("shows the name alone without a year", () => {
    expect(galleryByline("Tim Bower", null)).toBe("Tim Bower");
  });
});

describe("galleryColumnCount", () => {
  it("fits about one column per 240px, between two and six", () => {
    expect(galleryColumnCount(300)).toBe(2);
    expect(galleryColumnCount(960)).toBe(4);
    expect(galleryColumnCount(1200)).toBe(5);
    expect(galleryColumnCount(4000)).toBe(6);
  });
});

describe("layoutMasonry", () => {
  const tile = (id: string, width: number, height: number) => ({ id, width, height });
  const ids = (cols: { id: string }[][]) => cols.map((c) => c.map((t) => t.id));

  it("fills left to right while the columns are level", () => {
    const items = ["a", "b", "c"].map((id) => tile(id, 100, 100));
    expect(ids(layoutMasonry(items, 3))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("drops each tile into the shortest column", () => {
    const items = [tile("tall", 100, 300), tile("wide", 300, 100), tile("next", 100, 100)];
    expect(ids(layoutMasonry(items, 2))).toEqual([["tall"], ["wide", "next"]]);
  });

  it("keeps every item exactly once", () => {
    const items = Array.from({ length: 23 }, (_, i) => tile(String(i), 100, 50 + i * 7));
    const cols = layoutMasonry(items, 4);
    expect(cols).toHaveLength(4);
    expect(cols.flat().map((t) => t.id).sort()).toEqual(items.map((t) => t.id).sort());
  });

  it("falls back to one column", () => {
    expect(ids(layoutMasonry([tile("a", 1, 1), tile("b", 1, 1)], 0))).toEqual([["a", "b"]]);
  });
});

describe("toggleReaction", () => {
  it("adds a new emoji in palette order", () => {
    expect(isGalleryEmoji("❤️")).toBe(true);
    expect(toggleReaction([{ emoji: "🎉", count: 2, mine: false }], "❤️")).toEqual([
      { emoji: "❤️", count: 1, mine: true },
      { emoji: "🎉", count: 2, mine: false },
    ]);
  });

  it("joins someone else's reaction", () => {
    expect(toggleReaction([{ emoji: "🔥", count: 2, mine: false }], "🔥")).toEqual([
      { emoji: "🔥", count: 3, mine: true },
    ]);
  });

  it("takes the viewer's back and drops an emptied chip", () => {
    expect(toggleReaction([{ emoji: "🔥", count: 3, mine: true }], "🔥")).toEqual([
      { emoji: "🔥", count: 2, mine: false },
    ]);
    expect(toggleReaction([{ emoji: "🔥", count: 1, mine: true }], "🔥")).toEqual([]);
  });
});

describe("galleryFeedHref", () => {
  it("is the bare feed with no filter", () => {
    expect(galleryFeedHref({})).toBe("/community/gallery");
  });

  it("filters to a person, which replaces Mine", () => {
    expect(galleryFeedHref({ by: "u7" })).toBe("/community/gallery?by=u7");
    expect(galleryFeedHref({ by: "u7", mine: true })).toBe("/community/gallery?by=u7");
  });

  it("keeps Mine alongside a trimmed search", () => {
    expect(galleryFeedHref({ mine: true, q: "  demo day " })).toBe(
      "/community/gallery?show=mine&q=demo+day",
    );
  });

  it("drops a blank search", () => {
    expect(galleryFeedHref({ q: "   " })).toBe("/community/gallery");
  });
});

describe("galleryDownloadName", () => {
  const key = `uploads/gallery/u1/${UUID}-IMG_0042.JPG`;

  it("names the file after the caption's first words, keeping the extension", () => {
    expect(galleryDownloadName("Demo Day setup in the atrium!", key)).toBe(
      "gallery-demo-day-setup-in-the-atrium.jpg",
    );
  });

  it("folds accents and drops emoji", () => {
    expect(galleryDownloadName("Café night 🎉", key)).toBe("gallery-cafe-night.jpg");
  });

  it("caps the name without leaving a trailing dash", () => {
    const name = galleryDownloadName("word ".repeat(30), key);
    expect(name.length).toBeLessThanOrEqual("gallery-.jpg".length + 48);
    expect(name).not.toMatch(/-\.jpg$/);
  });

  it("falls back to photo without a usable caption", () => {
    expect(galleryDownloadName(null, key)).toBe("gallery-photo.jpg");
    expect(galleryDownloadName("🎉🎉", key)).toBe("gallery-photo.jpg");
  });

  it("uses jpg when the key has no extension", () => {
    expect(galleryDownloadName("x", `uploads/gallery/u1.d/${UUID}-noext`)).toBe("gallery-x.jpg");
  });
});

describe("encodeGalleryThumb", () => {
  // A canvas that encodes the listed types and falls back to PNG for anything else, as browsers do.
  const canvas = (supported: string[]) => {
    const calls: Array<[string, number]> = [];
    const toBlob = async (type: string, quality: number) => {
      calls.push([type, quality]);
      return new Blob(["x"], { type: supported.includes(type) ? type : "image/png" });
    };
    return { calls, toBlob };
  };

  it("uses WebP where the browser can encode it", async () => {
    const { calls, toBlob } = canvas(["image/webp", "image/jpeg"]);
    const file = await encodeGalleryThumb(toBlob);
    expect(file?.type).toBe("image/webp");
    expect(file?.name).toBe("thumb.webp");
    expect(calls).toEqual([["image/webp", 0.82]]);
  });

  it("falls back to JPEG when WebP comes back as PNG (Safari, the macOS desktop app)", async () => {
    const { calls, toBlob } = canvas(["image/jpeg"]);
    const file = await encodeGalleryThumb(toBlob);
    expect(file?.type).toBe("image/jpeg");
    expect(file?.name).toBe("thumb.jpg");
    expect(calls.map(([type]) => type)).toEqual(["image/webp", "image/jpeg"]);
  });

  it("names the thumbnail so it passes the gallery accept list and key check", async () => {
    for (const supported of [["image/webp"], ["image/jpeg"]]) {
      const file = await encodeGalleryThumb(canvas(supported).toBlob);
      expect(isGalleryImageKey(key("u1", file!.name), "u1")).toBe(true);
    }
  });

  it("gives up when neither format encodes, so the tile uses the original", async () => {
    expect(await encodeGalleryThumb(canvas([]).toBlob)).toBeNull();
    expect(await encodeGalleryThumb(async () => null)).toBeNull();
  });
});
