import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DomainApplicationStatus } from "~/types";
import { inferDomainApplicationStatus } from "./domain-application-status";

// Where a domain application sits in the hiring pipeline, as the Applications
// page's status pie buckets it. Adds an "InProgress" bucket on top of
// `DomainApplicationStatus` for applications the owner never submitted.
export type PipelineStage = DomainApplicationStatus | "InProgress";

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  ApplicationOpen: "Application Open",
  InProgress: "In Progress",
  Pending: "Pending",
  InvitedToInterview: "Invited to Interview",
  InterviewScheduled: "Interview Scheduled",
  PostInterviewPending: "Post-Interview",
  Withdrawn: "Withdrawn",
  Accepted: "Accepted",
  AcceptedElsewhere: "Accepted elsewhere",
  Rejected: "Rejected",
  Waitlisted: "Waitlisted",
};

// Display order for the pie/legend.
export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  "InProgress",
  "Pending",
  "InvitedToInterview",
  "InterviewScheduled",
  "PostInterviewPending",
  "Accepted",
  "AcceptedElsewhere",
  "Waitlisted",
  "Rejected",
  "Withdrawn",
  "ApplicationOpen",
];

export function pipelineStage(
  da: Parameters<typeof inferDomainApplicationStatus>[0],
  cycleStatus: ApplicationCycleStatus,
): PipelineStage {
  const base = inferDomainApplicationStatus(da, cycleStatus);
  const hasSubmitted = da.application.statusUpdates.some((u) => u.newStatus === "Submitted");
  // Never submitted reads as in-progress work, regardless of cycle status,
  // except a DA closed because the applicant was placed in another domain,
  // which is a real terminal state.
  return !hasSubmitted && base !== "AcceptedElsewhere" ? "InProgress" : base;
}
