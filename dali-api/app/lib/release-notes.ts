import { NAV_AREAS } from "~/lib/nav-areas";

export const RELEASE_NOTE_VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";
export const RELEASE_NOTE_VIDEO_KEY_PREFIX = "release-notes/uploads";

export const RELEASE_NOTE_AREAS: { key: string; label: string }[] = [
  { key: "calendar", label: "Calendar" },
  ...NAV_AREAS.map((a) => ({ key: a.key, label: a.label })),
];

export function releaseNoteAreaLabel(key: string | null): string | null {
  if (!key) return null;
  return RELEASE_NOTE_AREAS.find((a) => a.key === key)?.label ?? key;
}

export type ReleaseNoteAudience = { allMembers: boolean; groupIds: string[] };

export type ReleaseNoteViewer = { isCore: boolean; groupIds: readonly string[] };

export function canViewReleaseNote(
  note: ReleaseNoteAudience,
  viewer: ReleaseNoteViewer,
): boolean {
  if (viewer.isCore || note.allMembers) return true;
  return note.groupIds.some((id) => viewer.groupIds.includes(id));
}

export function hasUnseenReleaseNotes(
  notes: (ReleaseNoteAudience & { publishedAt: Date | null })[],
  viewer: ReleaseNoteViewer,
  seenAt: Date | null,
): boolean {
  return notes.some(
    (n) =>
      n.publishedAt !== null &&
      (seenAt === null || n.publishedAt > seenAt) &&
      canViewReleaseNote(n, viewer),
  );
}

export function parsePrNumbers(raw: string): number[] {
  const nums = raw
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, ""))
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  return [...new Set(nums)];
}

export function isReleaseNoteVideoKey(key: string): boolean {
  return (
    key.startsWith(`${RELEASE_NOTE_VIDEO_KEY_PREFIX}/`) ||
    key.startsWith("uploads/" + RELEASE_NOTE_VIDEO_KEY_PREFIX + "/")
  );
}
