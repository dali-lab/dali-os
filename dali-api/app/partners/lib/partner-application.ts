// Shared partner-application stage vocabulary. Mirrors the convention in
// projects/lib/task-board.ts: one source of truth for the stage union, labels,
// pill palette, derived sets, and guard, imported by every route, API and MCP
// tool that touches PartnerApplication.stage.
//
// Four board columns. "Promoted" is not a stage — an Accepted application with
// a resultingProjectId is shown with a Project chip. Hold and learn-more are
// actions (holdUntil, the Request-more-info email), not columns.

export const PARTNER_STAGES = ["New", "Interview", "Accepted", "Rejected"] as const;

export type PartnerStage = (typeof PARTNER_STAGES)[number];

export const PARTNER_STAGE_LABELS: Record<PartnerStage, string> = {
  New: "New",
  Interview: "Interview",
  Accepted: "Accepted",
  Rejected: "Rejected",
};

// Pill tint per stage (Tailwind classes), shared by lists, the board columns
// and the modal so a stage looks identical wherever it appears.
export const PARTNER_STAGE_PILL: Record<PartnerStage, string> = {
  New: "bg-muted text-foreground",
  Interview: "bg-accent-coral/15 text-accent-coral",
  Accepted: "bg-accent-teal/25 text-accent-teal",
  Rejected: "bg-destructive/10 text-destructive",
};

// Stages that count toward the projected lab-headcount chart. New is too
// speculative; Rejected is dead. Accepted stays in until a project exists —
// callers exclude applications with a resultingProjectId, which already carry
// their own role requests.
export const PROJECTING_STAGES: PartnerStage[] = ["Interview", "Accepted"];

// Still in play: anything a stale sweep or next-step reminder should watch.
export const OPEN_STAGES: PartnerStage[] = ["New", "Interview"];

// Stages in which the partner may still edit their own pitch from the portal.
export const PARTNER_EDITABLE_STAGES: PartnerStage[] = ["New"];

export function isPartnerStage(x: unknown): x is PartnerStage {
  return typeof x === "string" && (PARTNER_STAGES as readonly string[]).includes(x);
}

export const PARTNER_REJECT_REASONS = [
  "NotAFit",
  "NoCapacity",
  "Funding",
  "Timing",
  "Withdrawn",
  "Other",
] as const;

export type PartnerRejectReason = (typeof PARTNER_REJECT_REASONS)[number];

export const PARTNER_REJECT_REASON_LABELS: Record<PartnerRejectReason, string> = {
  NotAFit: "Not a fit for the lab",
  NoCapacity: "No capacity this term",
  Funding: "Funding",
  Timing: "Timing",
  Withdrawn: "Partner withdrew",
  Other: "Other",
};

export function isPartnerRejectReason(x: unknown): x is PartnerRejectReason {
  return (
    typeof x === "string" && (PARTNER_REJECT_REASONS as readonly string[]).includes(x)
  );
}

// The partner-facing progress track collapses the stages to four milestones.
// Decision is reached at Accepted or Rejected; Project when a project exists.
export type PartnerTrackNode = "Submitted" | "Interview" | "Decision" | "Project";

export const PARTNER_TRACK_NODES: PartnerTrackNode[] = [
  "Submitted",
  "Interview",
  "Decision",
  "Project",
];

export function partnerTrackIndex(input: {
  stage: PartnerStage;
  resultingProjectId: string | null;
}): number {
  if (input.resultingProjectId) return 3;
  switch (input.stage) {
    case "New":
      return 0;
    case "Interview":
      return 1;
    case "Accepted":
    case "Rejected":
      return 2;
  }
}

/** A card parked with holdUntil in the future reads as Paused. */
export function isPaused(holdUntil: Date | string | null | undefined, now = new Date()): boolean {
  if (!holdUntil) return false;
  return new Date(holdUntil).getTime() > now.getTime();
}

/** Open, not paused, and quiet for longer than the stale threshold. */
export function isStale(
  input: { stage: PartnerStage; lastActivityAt: Date | string; holdUntil?: Date | string | null },
  staleDays: number,
  now = new Date(),
): boolean {
  if (!OPEN_STAGES.includes(input.stage)) return false;
  if (isPaused(input.holdUntil, now)) return false;
  const ageMs = now.getTime() - new Date(input.lastActivityAt).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}
