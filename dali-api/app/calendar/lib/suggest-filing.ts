import type { GroupOption } from "~/calendar/lib/types";

export type SuggestionKind = "project" | "core" | "offering";

export type Suggestion = {
  groupId: string;
  label: string;
  kind: SuggestionKind;
  score: number;
  reason: string;
};

const MIN_SCORE = 0.5;
const MIN_OVERLAP = 2;
const MIN_NAME_LENGTH = 4;
const MAX_SUGGESTIONS = 2;
const NAME_IN_TITLE_BONUS = 0.5;
const CORE_IN_TITLE_BONUS = 0.3;

function kindOf(g: GroupOption): SuggestionKind | null {
  if (g.systemKey === "core") return "core";
  if (g.projectId) return "project";
  if (g.systemKey?.startsWith("offering:") || g.id.startsWith("offering:")) return "offering";
  return null;
}

function namedIn(title: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.length >= MIN_NAME_LENGTH && title.includes(n);
}

function reasonOf(overlap: number, total: number, titleMatch: boolean): string {
  const parts: string[] = [];
  if (overlap > 0) parts.push(`${overlap} of ${total} ${total === 1 ? "attendee" : "attendees"}`);
  if (titleMatch) parts.push("named in the title");
  return parts.join(" · ");
}

/** Where a meeting's notes probably belong, from who is invited and what the
 *  meeting is called. Never applied on its own: the modal offers these as chips. */
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

  const out: (Suggestion & { overlap: number })[] = [];
  for (const g of groups) {
    const kind = kindOf(g);
    if (!kind) continue;
    const overlap = new Set(g.memberIds.filter((id) => attendees.has(id))).size;
    const titleMatch = kind === "core" ? mentionsCore : namedIn(lowerTitle, g.name);
    const bonus = titleMatch ? (kind === "core" ? CORE_IN_TITLE_BONUS : NAME_IN_TITLE_BONUS) : 0;
    const score = (attendees.size === 0 ? 0 : overlap / attendees.size) + bonus;
    if (!titleMatch && !(score >= MIN_SCORE && overlap >= MIN_OVERLAP)) continue;
    out.push({
      groupId: g.id,
      label: g.name,
      kind,
      score,
      reason: reasonOf(overlap, attendees.size, titleMatch),
      overlap,
    });
  }

  return out
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.label.localeCompare(b.label) || a.groupId.localeCompare(b.groupId))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ overlap: _overlap, ...s }) => s);
}
