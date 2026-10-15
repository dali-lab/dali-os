export type DriveItemTag = { id: string; label: string; color: string | null };

export const MAX_TAG_DOTS = 3;

export function visibleTagDots(tags: readonly DriveItemTag[] | undefined): {
  shown: DriveItemTag[];
  overflow: number;
} {
  const all = tags ?? [];
  return { shown: all.slice(0, MAX_TAG_DOTS), overflow: Math.max(0, all.length - MAX_TAG_DOTS) };
}

// DocTag.color holds a hex value or a Tailwind token. Only hex is safe to drop
// into an inline style, so anything else renders neutral.
export function hexColor(color: string | null | undefined): string | undefined {
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : undefined;
}
