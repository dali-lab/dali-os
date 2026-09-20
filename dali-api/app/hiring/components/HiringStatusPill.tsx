// A DomainApplicationStatus as a labelled pill. The applicant-facing summary of
// one domain's outcome — used by the portal home's DALI application section and
// the combined /portal/applications history. Deliberately not the interactive
// StageIndicator, which belongs to the /portal/hiring tracker.
const HIRING_STATUS: Record<string, { label: string; className: string }> = {
  ApplicationOpen: { label: "Not submitted", className: "bg-muted text-muted-foreground" },
  Pending: { label: "Under review", className: "bg-amber-100 text-amber-800" },
  InvitedToInterview: { label: "Interview invite", className: "bg-blue-100 text-blue-800" },
  InterviewScheduled: { label: "Interview scheduled", className: "bg-blue-100 text-blue-800" },
  PostInterviewPending: { label: "Decision pending", className: "bg-blue-100 text-blue-800" },
  Accepted: { label: "Accepted", className: "bg-green-100 text-green-800" },
  AcceptedElsewhere: { label: "Placed elsewhere", className: "bg-muted text-muted-foreground" },
  Waitlisted: { label: "Waitlisted", className: "bg-amber-100 text-amber-800" },
  Rejected: { label: "Not accepted", className: "bg-muted text-muted-foreground" },
  Withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
};

export function HiringStatusPill({ status }: { status: string }) {
  const s = HIRING_STATUS[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${s.className}`}
    >
      {s.label}
    </span>
  );
}
