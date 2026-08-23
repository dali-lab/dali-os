// Shared partner-application status vocabulary. Mirrors the convention in
// projects/lib/task-board.ts: one source of truth for the status union,
// labels, color palette, and guard, imported by the routes + API that
// touch PartnerApplication.status.
//
// This is the account-first CRM funnel. `Submitted` is a deprecated pre-CRM
// value kept only in the Postgres enum (it can't be dropped); the backfill
// remapped every row off it, so it is intentionally absent from this list.

export const PARTNER_APPLICATION_STATUSES = [
  "Inquiry",
  "Triaged",
  "Meeting",
  "ApplicationSubmitted",
  "UnderReview",
  "LearnMore",
  "OnHold",
  "Accepted",
  "Rejected",
  "Promoted",
] as const;

// The type includes the deprecated "Submitted" value because the Postgres enum
// still carries it (values can't be dropped) and Prisma therefore reports it on
// reads. It is intentionally absent from PARTNER_APPLICATION_STATUSES above so
// it's never offered as a board column or a settable choice — only mapped for
// display of any legacy row the backfill somehow missed.
export type PartnerApplicationStatus =
  | (typeof PARTNER_APPLICATION_STATUSES)[number]
  | "Submitted";

export const PARTNER_APPLICATION_STATUS_LABELS: Record<
  PartnerApplicationStatus,
  string
> = {
  Inquiry: "Inquiry",
  Triaged: "Triaged",
  Meeting: "Meeting",
  ApplicationSubmitted: "Application submitted",
  UnderReview: "Under review",
  LearnMore: "Learn more",
  OnHold: "On hold",
  Accepted: "Accepted",
  Rejected: "Rejected",
  Promoted: "Promoted",
  Submitted: "Application submitted",
};

// Pill tint per status (Tailwind classes), shared by the list table and the
// board columns so a status looks identical wherever it appears.
export const PARTNER_APPLICATION_STATUS_PILL: Record<
  PartnerApplicationStatus,
  string
> = {
  Inquiry: "bg-muted text-muted-foreground",
  Triaged: "bg-muted text-foreground",
  Meeting: "bg-accent-coral/15 text-accent-coral",
  ApplicationSubmitted: "bg-muted text-foreground",
  UnderReview: "bg-accent-teal/15 text-accent-teal",
  LearnMore: "bg-amber-500/15 text-amber-600",
  OnHold: "bg-muted/50 text-muted-foreground",
  Accepted: "bg-accent-teal/25 text-accent-teal",
  Rejected: "bg-destructive/10 text-destructive",
  Promoted: "bg-accent-teal/30 text-accent-teal",
  Submitted: "bg-muted text-foreground",
};

// Statuses that count toward the projected lab-headcount chart. Early-funnel
// (Inquiry/Triaged/ApplicationSubmitted) and LearnMore/OnHold are too
// speculative; Rejected is dead; Promoted already became a real project with
// its own role requests. Meeting/UnderReview are the realistic near-term
// pipeline, and Accepted is committed but not yet promoted.
export const PROJECTING_STATUSES: PartnerApplicationStatus[] = [
  "Meeting",
  "UnderReview",
  "Accepted",
];

// Statuses that read as "still in play" — everything that isn't a terminal
// Rejected/Promoted outcome (Accepted is still open until promotion lands).
export const OPEN_APPLICATION_STATUSES: PartnerApplicationStatus[] = [
  "Inquiry",
  "Triaged",
  "Meeting",
  "ApplicationSubmitted",
  "UnderReview",
  "LearnMore",
  "OnHold",
  "Accepted",
];

// Terminal outcomes: no further funnel movement.
export const TERMINAL_APPLICATION_STATUSES: PartnerApplicationStatus[] = [
  "Rejected",
  "Promoted",
];

// Statuses in which the partner may still edit their own pitch (before a
// decision is rendered). Rejected/Accepted/Promoted freeze the pitch.
export const PARTNER_EDITABLE_STATUSES: PartnerApplicationStatus[] = [
  "Inquiry",
  "Triaged",
  "Meeting",
  "ApplicationSubmitted",
  "UnderReview",
  "LearnMore",
];

export function isPartnerApplicationStatus(
  x: unknown,
): x is PartnerApplicationStatus {
  return (
    typeof x === "string" &&
    (PARTNER_APPLICATION_STATUSES as readonly string[]).includes(x)
  );
}
