// Shared partner-application status vocabulary. Mirrors the convention in
// projects/lib/task-board.ts: one source of truth for the status union,
// labels, color palette, and guard, imported by the routes + API that
// touch PartnerApplication.status.

export const PARTNER_APPLICATION_STATUSES = [
  "Submitted",
  "RejectedPreInterview",
  "InterviewInviteSent",
  "InterviewScheduled",
  "RejectedPostInterview",
  "InterviewCompleted",
  "Accepted",
  "ScopeCreated",
  "ScopeApproved",
  "ConfirmedStart",
] as const;

export type PartnerApplicationStatus =
  (typeof PARTNER_APPLICATION_STATUSES)[number];

export const PARTNER_APPLICATION_STATUS_LABELS: Record<
  PartnerApplicationStatus,
  string
> = {
  Submitted: "New Submission",
  RejectedPreInterview: "Rejected Pre-Interview",
  InterviewInviteSent: "Interview Invite Sent",
  InterviewScheduled: "Interview Scheduled",
  RejectedPostInterview: "Rejected Post-Interview",
  InterviewCompleted: "Interview Completed",
  Accepted: "Accepted",
  ScopeCreated: "Scope Created",
  ScopeApproved: "Scope Approved",
  ConfirmedStart: "Confirmed Start",
};

// Pill tint per status (Tailwind classes), shared by the list table and the
// board columns so a status looks identical wherever it appears.
export const PARTNER_APPLICATION_STATUS_PILL: Record<
  PartnerApplicationStatus,
  string
> = {
  Submitted: "bg-muted text-foreground",
  RejectedPreInterview: "bg-destructive/10 text-destructive",
  InterviewInviteSent: "bg-accent-teal/15 text-accent-teal",
  InterviewScheduled: "bg-accent-teal/25 text-accent-teal",
  RejectedPostInterview: "bg-destructive/10 text-destructive",
  InterviewCompleted: "bg-accent-teal/40 text-accent-teal",
  Accepted: "bg-accent-teal/50 text-accent-teal",
  ScopeCreated: "bg-accent-coral/15 text-accent-coral",
  ScopeApproved: "bg-accent-coral/30 text-accent-coral",
  ConfirmedStart: "bg-accent-coral/50 text-white",
};

// Statuses that count toward the projected lab-headcount chart. Early-stage
// and rejected statuses are too speculative or dead. From Accepted onward the
// engagement is real enough to include in the projection.
export const PROJECTING_STATUSES: PartnerApplicationStatus[] = [
  "Accepted",
  "ScopeCreated",
  "ScopeApproved",
  "ConfirmedStart",
];

// Statuses that represent a definitive rejection (card is visually muted).
export const REJECTED_STATUSES: PartnerApplicationStatus[] = [
  "RejectedPreInterview",
  "RejectedPostInterview",
];

export function isPartnerApplicationStatus(
  x: unknown,
): x is PartnerApplicationStatus {
  return (
    typeof x === "string" &&
    (PARTNER_APPLICATION_STATUSES as readonly string[]).includes(x)
  );
}
