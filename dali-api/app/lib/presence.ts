export type PresenceState = "active" | "recent" | "away";

export interface AvatarStatus {
  state: PresenceState;
  lastActiveAt: string | null; // ISO string or null
}

/** Derive presence state from a lastActiveAt timestamp relative to `now`. */
export function derivePresenceState(
  lastActiveAt: Date | null,
  now: Date,
  hideActivity = false,
): PresenceState {
  if (hideActivity || !lastActiveAt) return "away";
  const ms = now.getTime() - lastActiveAt.getTime();
  if (ms < 5 * 60 * 1000) return "active";
  if (ms < 60 * 60 * 1000) return "recent";
  return "away";
}

/**
 * Human-readable "Active N minutes/hours/days ago" label for the status dot
 * tooltip. Returns null when there's nothing worth showing (state === "away"
 * with no useful timestamp).
 */
export function formatLastActive(date: Date | null, now: Date): string | null {
  if (!date) return null;
  const ms = now.getTime() - date.getTime();
  if (ms < 60 * 1000) return "Active now";
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes < 60) return minutes === 1 ? "Active 1 minute ago" : `Active ${minutes} minutes ago`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return hours === 1 ? "Active 1 hour ago" : `Active ${hours} hours ago`;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "Active 1 day ago" : `Active ${days} days ago`;
}
