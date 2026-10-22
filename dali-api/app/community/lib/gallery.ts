// Community gallery. Client-safe: limits, key and payload validation, and the
// masonry layout shared by the feed, the post page and the action.

export const GALLERY_EMOJI = ["❤️", "🔥", "😂", "👏", "😮", "🎉"] as const;

export const GALLERY_CAPTION_MAX = 500;
export const GALLERY_COMMENT_MAX = 1000;
export const GALLERY_MAX_PHOTOS = 20;
export const GALLERY_PAGE_SIZE = 40;
/** Distinct reports that hide a post until Core restores it. */
export const GALLERY_REPORTS_TO_HIDE = 2;
export const GALLERY_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function isGalleryEmoji(value: string): boolean {
  return (GALLERY_EMOJI as readonly string[]).includes(value);
}

/** The prefix a viewer's uploads go under (the presign route adds uploads/). */
export function galleryKeyPrefix(userId: string): string {
  return `gallery/${userId}`;
}

// The action stores whatever key the client names, so it only accepts the
// shape uploadFileToS3 mints under the poster's own prefix.
export function isGalleryImageKey(key: string, userId: string): boolean {
  const prefix = `uploads/${galleryKeyPrefix(userId)}/`;
  if (!key.startsWith(prefix)) return false;
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,200}$/.test(key.slice(prefix.length));
}

export type NewGalleryPost = {
  imageKey: string;
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
    const { imageKey, width, height, color, caption } = row as Record<string, unknown>;
    if (typeof imageKey !== "string" || !isGalleryImageKey(imageKey, userId)) return null;
    if (!isSide(width) || !isSide(height)) return null;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    if (caption != null && typeof caption !== "string") return null;
    const text = typeof caption === "string" ? caption.trim() : "";
    if (text.length > GALLERY_CAPTION_MAX) return null;
    posts.push({ imageKey, width, height, color: color.toLowerCase(), caption: text || null });
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
