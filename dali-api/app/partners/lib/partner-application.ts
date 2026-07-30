// Shared partner-application status vocabulary. Mirrors the convention in
// projects/lib/task-board.ts: one source of truth for the status union,
// labels, color palette, and guard, imported by the routes + API that
// touch PartnerApplication.status.

export const PARTNER_APPLICATION_STATUSES = [
  "Submitted",
  "UnderReview",
  "OnHold",
  "Accepted",
  "Rejected",
  "Withdrawn",
] as const;

export type PartnerApplicationStatus =
  (typeof PARTNER_APPLICATION_STATUSES)[number];

export const PARTNER_APPLICATION_STATUS_LABELS: Record<
  PartnerApplicationStatus,
  string
> = {
  Submitted: "Submitted",
  UnderReview: "Under review",
  OnHold: "On hold",
  Accepted: "Accepted",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
};

// Pill tint per status (Tailwind classes), shared by the list table and the
// board columns so a status looks identical wherever it appears.
export const PARTNER_APPLICATION_STATUS_PILL: Record<
  PartnerApplicationStatus,
  string
> = {
  Submitted: "bg-muted text-foreground",
  UnderReview: "bg-accent-teal/15 text-accent-teal",
  OnHold: "bg-muted/50 text-muted-foreground",
  Accepted: "bg-accent-teal/25 text-accent-teal",
  Rejected: "bg-destructive/10 text-destructive",
  Withdrawn: "bg-muted/50 text-muted-foreground line-through",
};

// Statuses that count toward the projected lab-headcount chart. Submitted /
// OnHold are too speculative; Rejected is dead. Accepted is committed;
// UnderReview is the realistic near-term pipeline.
export const PROJECTING_STATUSES: PartnerApplicationStatus[] = [
  "UnderReview",
  "Accepted",
];

// Statuses that read as "still in play" on the Organizations pages —
// everything that isn't a terminal Accepted/Rejected outcome.
export const OPEN_APPLICATION_STATUSES: PartnerApplicationStatus[] = [
  "Submitted",
  "UnderReview",
  "OnHold",
];

export function isPartnerApplicationStatus(
  x: unknown,
): x is PartnerApplicationStatus {
  return (
    typeof x === "string" &&
    (PARTNER_APPLICATION_STATUSES as readonly string[]).includes(x)
  );
}
