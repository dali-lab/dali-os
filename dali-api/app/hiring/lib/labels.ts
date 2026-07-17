// Shared color + label maps for hiring status/decision/stage pills.
// Source of truth for adoption (wave 2); see callers in app/hiring/routes
// and app/hiring/components. Plain (border-less) variants chosen as the
// majority across sites; bordered/dark-mode variants stay local where used.

// Cycle / Application cycle status pills.
// Matches lead.tsx, CycleSelector.tsx, lead.cycle.$id.tsx.
export const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted text-foreground/80",
  Open: "bg-green-100 text-green-700",
  UnderReview: "bg-yellow-100 text-yellow-700",
  Completed: "bg-blue-100 text-blue-700",
};

// Display labels for the cycle status enum.
export const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

// Decision pill colors. Plain (border-less) majority variant.
// InvitedToInterview is bg-blue-100 (majority); fixes purple drift at
// domain-lead.application.$id.tsx:44.
export const DECISION_COLORS: Record<string, string> = {
  InvitedToInterview: "bg-blue-100 text-blue-700",
  Accepted: "bg-green-100 text-green-700",
  Waitlisted: "bg-yellow-100 text-yellow-700",
  Rejected: "bg-red-100 text-red-700",
};

// Short decision labels used on action buttons / compact pills.
// Source: domain-lead.tsx:2049.
export const DECISION_LABELS: Record<string, string> = {
  InvitedToInterview: "Interview",
  Accepted: "Accept",
  Waitlisted: "Waitlist",
  Rejected: "Reject",
};

// Interview status colors. Keys match the InterviewStatus enum used in
// applications.$domainApplicationId.tsx:13 and interviewer.interview.$interviewId.tsx:38.
export const INTERVIEW_STATUS_COLORS: Record<string, string> = {
  Scheduled: "bg-blue-100 text-blue-700",
  Completed: "bg-green-100 text-green-700",
  CancelledByApplicant: "bg-red-100 text-red-700",
  CancelledByAdmin: "bg-muted text-foreground/80",
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

// Reviewer overall-recommendation pills. Source: ApplicantContextModal.tsx:6
// and domain-lead.application.$id.tsx:19.
export const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Hire": "bg-green-100 text-green-800",
  Hire: "bg-green-50 text-green-700",
  "Lean Hire": "bg-yellow-50 text-yellow-700",
  "Lean No Hire": "bg-orange-50 text-orange-700",
  "No Hire": "bg-red-100 text-red-700",
};

// Shared base classes for the common pill shape. Compose with one of the
// *_COLORS maps above: `${STATUS_PILL_BASE} ${STATUS_COLORS[s]}`.
export const STATUS_PILL_BASE =
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold";
