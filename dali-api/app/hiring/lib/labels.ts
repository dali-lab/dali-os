// Shared label + tone maps for hiring status/decision/stage pills. Every
// status renders through the shared <Pill>: `tone` tints the whole chip (a
// section's readiness), `dot` keeps the chip neutral and colours a leading dot
// (one state per row). One vocabulary across the area:
//   success  finished or good: accepted, submitted, completed, open
//   accent   in flight: invited, interviewing, scheduled, under review
//   warning  needs attention: waitlisted, in progress, awaiting, not ready
//   danger   bad: rejected, cancelled
//   neutral  nothing yet: draft, unknown
import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";

// Cycle / Application cycle status pills.
// Matches lead.tsx, CycleSelector.tsx, lead.cycle.$id.tsx.
export const STATUS_TONES: Record<string, PillTone> = {
  Draft: "neutral",
  Open: "success",
  UnderReview: "accent",
  Completed: "success",
};

// Display labels for the cycle status enum.
export const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

// Decision pill tones.
export const DECISION_TONES: Record<string, PillTone> = {
  InvitedToInterview: "accent",
  Accepted: "success",
  Waitlisted: "warning",
  Rejected: "danger",
};

// Short decision labels used on action buttons / compact pills.
// Source: domain-lead.tsx:2049.
export const DECISION_LABELS: Record<string, string> = {
  InvitedToInterview: "Interview",
  Accepted: "Accept",
  Waitlisted: "Waitlist",
  Rejected: "Reject",
};

// Interview status tones. Keys match the InterviewStatus enum used in
// applications.$domainApplicationId.tsx:13 and interviewer.interview.$interviewId.tsx:38.
export const INTERVIEW_STATUS_TONES: Record<string, PillTone> = {
  Scheduled: "accent",
  Completed: "success",
  CancelledByApplicant: "danger",
  CancelledByAdmin: "danger",
};

// Display overrides for interview status. Scheduled/Completed render as-is.
// Source: applications.$domainApplicationId.tsx:20.
export const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  CancelledByApplicant: "Cancelled (applicant)",
  CancelledByAdmin: "Cancelled (admin)",
};

// Decision lifecycle stages (Draft -> Final -> Released). Final renders as
// "Finalized" for users.
export const STAGE_LABELS: Record<string, string> = {
  Draft: "Draft",
  Final: "Finalized",
  Released: "Released",
};

// Reviewer overall-recommendation pills, by how strong the call is.
export const RECOMMENDATION_TONES: Record<string, PillTone> = {
  "Strong Hire": "success",
  Hire: "success",
  "Lean Hire": "warning",
  "Lean No Hire": "warning",
  "No Hire": "danger",
};

// A review's own progress, keyed the same way my-work keys it.
export const REVIEW_STATUS_TONES: Record<string, PillTone> = {
  submitted: "success",
  inProgress: "warning",
  notStarted: "neutral",
};
