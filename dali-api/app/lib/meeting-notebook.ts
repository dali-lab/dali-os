// Which notebook a meeting's note belongs in. A notebook is one Drive document
// (a Page carrying `notebookKey`) whose child pages are the individual notes,
// shown as side tabs. Pure, so the grouping rules can be tested without Prisma;
// the find-or-create lives in ensureMeetingNotebook (pages.ts).
//
//   • Team / Partner project meetings share one notebook per project per term.
//   • Everything else shares one per audience: the group or project the meeting
//     was scoped to, or the exact set of people invited. A recurring series
//     always has the same audience, so its occurrences land together, and a
//     one-off meeting with the same people joins the notes they already have.

import { createHash } from "node:crypto";
import type { MeetingType, ScopeType } from "~/generated/prisma/client";

export type NotebookMeeting = {
  title: string;
  meetingType: MeetingType;
  meetingTypeLabel: string | null;
  projectId: string | null;
  isCoreMeeting: boolean;
  scopeType: ScopeType;
  scopeId: string | null;
  organizerId: string;
  participantUserIds: string[];
  guestEmails: string[];
};

export type NotebookTerm = { id: string; code: string; startDate: Date };

/**
 * The term a note dated `date` is filed under. `windows` is newest first (see
 * termWindows). A date in a break belongs to the term before it, and one
 * earlier than every term to the oldest, so a note always has a term once any
 * exist.
 */
export function termForDate<T extends NotebookTerm>(windows: T[], date: Date): T | null {
  return windows.find((w) => w.startDate <= date) ?? windows.at(-1) ?? null;
}

function audienceKey(m: NotebookMeeting): string {
  if ((m.scopeType === "Group" || m.scopeType === "Project") && m.scopeId) {
    return `${m.scopeType}:${m.scopeId}`;
  }
  const people = [
    ...new Set([m.organizerId, ...m.participantUserIds, ...m.guestEmails.map((e) => e.toLowerCase())]),
  ].sort();
  return `users:${createHash("sha256").update(people.join("\n")).digest("hex").slice(0, 32)}`;
}

export function meetingNotebookIdentity(
  m: NotebookMeeting,
  term: NotebookTerm | null,
): { key: string; title: string } {
  if (m.projectId && (m.meetingType === "Team" || m.meetingType === "Partner")) {
    return {
      key: `project:${m.projectId}:${m.meetingType}:${term?.id ?? "none"}`,
      title: term ? `${m.meetingType} meeting note ${term.code}` : `${m.meetingType} meeting note`,
    };
  }
  const bucket = m.projectId ? `project:${m.projectId}` : m.isCoreMeeting ? "core" : "general";
  const label = m.meetingTypeLabel?.trim() || m.title.trim() || "Meeting";
  return {
    key: `${bucket}:${audienceKey(m)}`,
    title: /meeting$/i.test(label) ? `${label} notes` : `${label} meeting notes`,
  };
}
