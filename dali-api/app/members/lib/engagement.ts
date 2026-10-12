// Alumni engagement score for the Connect leaderboard. Client-safe and pure.
// Only activity after someone became an alum counts, so the board measures
// staying involved rather than rewarding the meetings every student attended.

export const ENGAGEMENT_ACTIVITIES = [
  { key: "taught", label: "Taught a workshop or course", points: 10 },
  { key: "coffeeChats", label: "Coffee chat", points: 5 },
  { key: "sessions", label: "Attended a workshop session", points: 2 },
  { key: "meetings", label: "Attended a meeting", points: 1 },
] as const;

export type EngagementKey = (typeof ENGAGEMENT_ACTIVITIES)[number]["key"];
export type EngagementCounts = Record<EngagementKey, number>;

export function engagementScore(counts: EngagementCounts): number {
  return ENGAGEMENT_ACTIVITIES.reduce((sum, a) => sum + a.points * counts[a.key], 0);
}

export type EngagementEvent = { userId: string; kind: EngagementKey; at: Date };

/**
 * Count each alum's events on or after the day they became an alum. An alum
 * with no known graduation date (a null cutoff) has everything counted.
 */
export function countEngagement(
  alumni: readonly { id: string; alumSince: Date | null }[],
  events: readonly EngagementEvent[],
): Map<string, EngagementCounts> {
  const since = new Map(alumni.map((a) => [a.id, a.alumSince]));
  const out = new Map<string, EngagementCounts>(
    alumni.map((a) => [a.id, { taught: 0, coffeeChats: 0, sessions: 0, meetings: 0 }]),
  );
  for (const e of events) {
    const counts = out.get(e.userId);
    if (!counts) continue;
    const cutoff = since.get(e.userId);
    if (cutoff && e.at < cutoff) continue;
    counts[e.kind] += 1;
  }
  return out;
}

export type LeaderboardEntry = {
  id: string;
  name: string;
  photoUrl: string | null;
  classYear: number | null;
  score: number;
  counts: EngagementCounts;
};

/** Highest score first; alumni with no points are left off. */
export function rankLeaderboard<T extends { name: string; score: number }>(
  entries: readonly T[],
  limit: number,
): T[] {
  return entries
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "2 coffee chats, 1 workshop taught" for a row's tooltip-free detail line. */
export function describeCounts(counts: EngagementCounts): string {
  const parts: Array<[number, string, string]> = [
    [counts.taught, "taught", "taught"],
    [counts.coffeeChats, "coffee chat", "coffee chats"],
    [counts.sessions, "workshop session", "workshop sessions"],
    [counts.meetings, "meeting", "meetings"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
}
