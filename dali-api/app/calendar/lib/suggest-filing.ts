import type { GroupOption, MentorPairOption } from "~/calendar/lib/types";

export type SuggestionKind = "project" | "core";

export type Suggestion = {
  groupId: string;
  label: string;
  kind: SuggestionKind;
  score: number;
  overlap: number;
  attendees: number;
  reason: string;
};

const MIN_OVERLAP = 1;
const MIN_NAME_LENGTH = 4;
const MAX_SUGGESTIONS = 3;
const NAME_IN_TITLE_BONUS = 0.5;
const CORE_IN_TITLE_BONUS = 0.3;

function kindOf(g: GroupOption): SuggestionKind | null {
  if (g.systemKey === "core") return "core";
  if (g.projectId) return "project";
  return null;
}

function namedIn(title: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.length >= MIN_NAME_LENGTH && title.includes(n);
}

function reasonOf(overlap: number, attendees: number): string {
  if (overlap === 0) return "named in the title";
  return `${overlap} of ${attendees} ${attendees === 1 ? "attendee" : "attendees"}`;
}

export function suggestFiling({
  attendeeIds,
  groups,
  title,
}: {
  attendeeIds: string[];
  groups: GroupOption[];
  title: string;
}): Suggestion[] {
  const attendees = new Set(attendeeIds);
  const lowerTitle = title.toLowerCase();
  const mentionsCore = /\bcore\b/.test(lowerTitle);

  const out: Suggestion[] = [];
  for (const g of groups) {
    const kind = kindOf(g);
    if (!kind) continue;
    const members = new Set(g.memberIds);
    const overlap = [...members].filter((id) => attendees.has(id)).length;
    const titleMatch = kind === "core" ? mentionsCore : namedIn(lowerTitle, g.name);
    if (!titleMatch && overlap < MIN_OVERLAP) continue;
    const bonus = titleMatch ? (kind === "core" ? CORE_IN_TITLE_BONUS : NAME_IN_TITLE_BONUS) : 0;
    const coverage = members.size === 0 ? 0 : overlap / members.size;
    out.push({
      groupId: g.id,
      label: g.name,
      kind,
      score: coverage + bonus,
      overlap,
      attendees: attendees.size,
      reason: reasonOf(overlap, attendees.size),
    });
  }

  return out
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.label.localeCompare(b.label) || a.groupId.localeCompare(b.groupId))
    .slice(0, MAX_SUGGESTIONS);
}

export type PairSuggestion = { menteeId: string; label: string; reason: string };

export const PAIR_REASON = "your mentee";

/** A 1:1 with one of the viewer's mentees: no groups, nobody else, and the mentee on the invite. */
export function suggestPairFiling({
  attendeeIds,
  viewerId,
  groupsInvited,
  pairs,
}: {
  attendeeIds: string[];
  viewerId: string;
  groupsInvited: boolean;
  pairs: MentorPairOption[];
}): PairSuggestion | null {
  if (groupsInvited) return null;
  const others = new Set(attendeeIds.filter((id) => id !== viewerId));
  if (others.size !== 1) return null;
  const [other] = others;
  const pair = pairs.find((p) => p.menteeId === other);
  return pair ? { menteeId: pair.menteeId, label: `Mentorship · ${pair.menteeName}`, reason: PAIR_REASON } : null;
}
