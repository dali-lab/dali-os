import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import { DECISION_TONES, STAGE_LABELS } from "./labels";

// One applicant's stage changes as a single ordered list: what the applicant
// did (submitted, withdrew), what delibs decided, what interviews happened, and
// every decision row. The detail pages render this instead of a separate
// Decisions list and Delibs list, so the order of events is readable at a
// glance.
//
// Client-safe: pure functions over already-loaded rows, no Prisma.

export type TimelineEntry = {
  id: string;
  /** ISO timestamp the entry is sorted and dated by. */
  at: string;
  /** What happened, e.g. "Invited to interview". */
  label: string;
  /** The chip on the right of the label: the stage, or where it came from. */
  badge: string;
  tone: PillTone;
  /** Secondary line: the delib column, a decision's notes, the interview time. */
  detail?: string | null;
  /** Who made it happen, when a person did. */
  by?: string | null;
  /** Pre-release decisions and delibs context: leads only. */
  leadsOnly: boolean;
};

type StatusUpdateRow = { newStatus: string; createdAt: string | Date };

type DecisionRow = {
  id: string;
  type: string;
  stage: string;
  notes?: string | null;
  waitlistRank?: number | null;
  createdAt: string | Date;
  madeByName?: string | null;
};

type DelibsRow = {
  id: string;
  /** The round's label from the cycle timeline, e.g. "First delib". */
  label: string;
  status: "Active" | "Closed";
  /** Which column this applicant sits in on that board. */
  column: string | null;
  updatedAt: string | Date;
};

type InterviewRow = {
  id: string;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
};

/** Full words, unlike DECISION_LABELS which is sized for compact pills. */
const DECISION_EVENT_LABELS: Record<string, string> = {
  InvitedToInterview: "Invited to interview",
  Accepted: "Accepted",
  Waitlisted: "Waitlisted",
  Rejected: "Rejected",
};

const APPLICATION_EVENTS: Record<string, { label: string; tone: PillTone }> = {
  Submitted: { label: "Application submitted", tone: "success" },
  Withdrawn: { label: "Application withdrawn", tone: "danger" },
  Draft: { label: "Application started", tone: "neutral" },
};

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);

export function buildApplicationTimeline(input: {
  statusUpdates?: StatusUpdateRow[];
  decisions?: DecisionRow[];
  delibs?: DelibsRow[];
  interviews?: InterviewRow[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const [i, u] of (input.statusUpdates ?? []).entries()) {
    const event = APPLICATION_EVENTS[u.newStatus];
    if (!event) continue;
    entries.push({
      id: `status-${i}-${u.newStatus}`,
      at: iso(u.createdAt),
      label: event.label,
      badge: "Application",
      tone: event.tone,
      leadsOnly: false,
    });
  }

  for (const s of input.delibs ?? []) {
    // A board the applicant isn't on says nothing about them.
    if (!s.column) continue;
    entries.push({
      id: `delibs-${s.id}`,
      at: iso(s.updatedAt),
      label: s.label,
      badge: s.status === "Closed" ? "Delibs closed" : "In delibs",
      tone: s.status === "Closed" ? "neutral" : "accent",
      detail: `In "${s.column}"`,
      leadsOnly: true,
    });
  }

  for (const iv of input.interviews ?? []) {
    if (iv.status === "Completed") {
      entries.push({
        id: `interview-done-${iv.id}`,
        at: iso(iv.endTime),
        label: "Interview completed",
        badge: "Interview",
        tone: "success",
        leadsOnly: false,
      });
      continue;
    }
    const cancelled = iv.status.startsWith("Cancelled");
    entries.push({
      id: `interview-${iv.id}`,
      at: iso(iv.startTime),
      label: cancelled ? "Interview cancelled" : "Interview scheduled",
      badge: "Interview",
      tone: cancelled ? "danger" : "accent",
      leadsOnly: false,
    });
  }

  for (const d of input.decisions ?? []) {
    const rank = d.waitlistRank != null ? ` #${d.waitlistRank}` : "";
    entries.push({
      id: `decision-${d.id}`,
      at: iso(d.createdAt),
      label: `${DECISION_EVENT_LABELS[d.type] ?? d.type}${rank}`,
      badge: STAGE_LABELS[d.stage] ?? d.stage,
      tone: DECISION_TONES[d.type] ?? "neutral",
      detail: d.notes?.trim() || null,
      by: d.madeByName ?? null,
      // Draft and Final decisions are lead-only; a released one is the
      // applicant's actual outcome and can be shown to reviewers.
      leadsOnly: d.stage !== "Released",
    });
  }

  // Oldest first: the list reads as the applicant's progress through the cycle.
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/** Drop the lead-only entries for a viewer who can't see them. */
export function visibleTimeline(entries: TimelineEntry[], canSeeLeadsOnly: boolean): TimelineEntry[] {
  return canSeeLeadsOnly ? entries : entries.filter((e) => !e.leadsOnly);
}
