// Community gallery. Client-safe: limits, key and payload validation, and the
// masonry layout shared by the feed, the post page and the action.

export const GALLERY_EMOJI = ["❤️", "🔥", "😂", "👏", "😮", "🎉"] as const;

export const GALLERY_CAPTION_MAX = 500;
export const GALLERY_COMMENT_MAX = 1000;
// Each photo is up to three presigns (original, display copy, tile) against
// the presign route's 30 a minute, so a full batch has to fit in 10.
export const GALLERY_MAX_PHOTOS = 10;
export const GALLERY_PAGE_SIZE = 40;
/** Distinct reports that hide a post until Core restores it. */
export const GALLERY_REPORTS_TO_HIDE = 2;
export const GALLERY_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
/** Tiles load a thumbnail this wide; originals at or under it are used as-is. */
export const GALLERY_THUMB_WIDTH = 640;
/** The post page loads a copy this long on its longest side. */
export const GALLERY_DISPLAY_MAX = 2048;

const ENCODINGS = [
  { type: "image/webp", ext: "webp" },
  { type: "image/jpeg", ext: "jpg" },
] as const;

const QUALITY = { thumb: 0.82, display: 0.85 } as const;

// WebKit (Safari and the macOS desktop app) can't encode WebP and hands back
// a PNG instead, which would be bigger than the JPEG it can encode.
export async function encodeGalleryImage(
  toBlob: (type: string, quality: number) => Promise<Blob | null>,
  kind: keyof typeof QUALITY,
): Promise<File | null> {
  for (const { type, ext } of ENCODINGS) {
    const blob = await toBlob(type, QUALITY[kind]);
    if (blob?.type === type) return new File([blob], `${kind}.${ext}`, { type });
  }
  return null;
}

/** The display copy's size, or null when the original is already small enough to show. */
export function galleryDisplaySize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const long = Math.max(width, height);
  if (long <= GALLERY_DISPLAY_MAX) return null;
  const scale = GALLERY_DISPLAY_MAX / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isGalleryEmoji(value: string): boolean {
  return (GALLERY_EMOJI as readonly string[]).includes(value);
}

/** The prefix a viewer's display copies and tiles go under (the presign route adds uploads/). */
export function galleryKeyPrefix(userId: string): string {
  return `gallery/${userId}`;
}

/** The prefix a viewer's untouched originals go under. */
export function galleryOriginalKeyPrefix(userId: string): string {
  return `gallery-originals/${userId}`;
}

function isKeyUnder(key: string, prefix: string): boolean {
  const scoped = `uploads/${prefix}/`;
  if (!key.startsWith(scoped)) return false;
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,200}$/.test(key.slice(scoped.length));
}

// The action stores whatever key the client names, so it only accepts the
// shape uploadFileToS3 mints under the poster's own prefix.
export function isGalleryImageKey(key: string, userId: string): boolean {
  return isKeyUnder(key, galleryKeyPrefix(userId));
}

// Originals used to go under the gallery prefix itself, and a composer loaded
// before that changed still sends them there.
export function isGalleryOriginalKey(key: string, userId: string): boolean {
  return isKeyUnder(key, galleryOriginalKeyPrefix(userId)) || isGalleryImageKey(key, userId);
}

export type NewGalleryPost = {
  imageKey: string;
  displayKey: string | null;
  thumbKey: string | null;
  width: number;
  height: number;
  color: string;
  caption: string | null;
};

const MAX_SIDE = 20_000;
const isSide = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_SIDE;

/** Parses the composer's payload; null when any row is malformed. */
export function parseNewPosts(raw: string, userId: string): NewGalleryPost[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > GALLERY_MAX_PHOTOS) return null;
  const posts: NewGalleryPost[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const { imageKey, displayKey, thumbKey, width, height, color, caption } =
      row as Record<string, unknown>;
    if (typeof imageKey !== "string" || !isGalleryOriginalKey(imageKey, userId)) return null;
    for (const copy of [displayKey, thumbKey]) {
      if (copy != null && (typeof copy !== "string" || !isGalleryImageKey(copy, userId))) return null;
    }
    if (!isSide(width) || !isSide(height)) return null;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    if (caption != null && typeof caption !== "string") return null;
    const text = typeof caption === "string" ? caption.trim() : "";
    if (text.length > GALLERY_CAPTION_MAX) return null;
    posts.push({
      imageKey,
      displayKey: typeof displayKey === "string" ? displayKey : null,
      thumbKey: typeof thumbKey === "string" ? thumbKey : null,
      width,
      height,
      color: color.toLowerCase(),
      caption: text || null,
    });
  }
  return posts;
}

/** "Maya Chen '26"; staff with no class year show the name alone. */
export function galleryByline(name: string, classYear: number | null): string {
  return classYear ? `${name} '${String(classYear % 100).padStart(2, "0")}` : name;
}

/** Columns for a feed of the given width: about one per 240px, two to six. */
export function galleryColumnCount(width: number): number {
  return Math.min(6, Math.max(2, Math.floor(width / 240)));
}

// Each tile goes to the column that is currently shortest, so the feed reads
// left to right and the columns end close together. Height is the image's
// aspect plus a fixed allowance for the caption and byline under it.
export function layoutMasonry<T extends { width: number; height: number }>(
  items: T[],
  columns: number,
  footerRatio = 0.3,
): T[][] {
  const cols: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const heights = cols.map(() => 0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < heights.length; i++) if (heights[i] < heights[target]) target = i;
    cols[target].push(item);
    heights[target] += item.height / item.width + footerRatio;
  }
  return cols;
}

type Reaction = { emoji: string; count: number; mine: boolean };

/** The viewer's reaction toggled locally, in palette order, so a tap shows before the server answers. */
export function toggleReaction(reactions: Reaction[], emoji: string): Reaction[] {
  const hit = reactions.find((r) => r.emoji === emoji);
  const next = hit
    ? reactions
        .map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r))
        .filter((r) => r.count > 0)
    : [...reactions, { emoji, count: 1, mine: true }];
  const order = (e: string) => (GALLERY_EMOJI as readonly string[]).indexOf(e);
  return next.sort((a, b) => order(a.emoji) - order(b.emoji));
}

/** "gallery-demo-day-setup.jpg": the caption's first words, or the post's own name without one. */
export function galleryDownloadName(caption: string | null, imageKey: string): string {
  const dot = imageKey.lastIndexOf(".");
  const ext = dot > imageKey.lastIndexOf("/") ? imageKey.slice(dot + 1).toLowerCase() : "jpg";
  const slug = (caption ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `gallery-${slug || "photo"}.${ext}`;
}

export const GALLERY_FEED = "/community/gallery";

/** The feed's URL for a filter. A person filter replaces Mine; search keeps whichever is on. */
export function galleryFeedHref({
  mine = false,
  by = null,
  q = "",
}: {
  mine?: boolean;
  by?: string | null;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (by) params.set("by", by);
  else if (mine) params.set("show", "mine");
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return qs ? `${GALLERY_FEED}?${qs}` : GALLERY_FEED;
}
