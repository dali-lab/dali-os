import { Pill, type PillTone } from "~/components/ui/Pill";

// The applicant-facing summary of one domain's outcome. Deliberately not the interactive
// StageIndicator, which belongs to the /portal/hiring tracker.
export const HIRING_STATUS: Record<string, { label: string; tone: PillTone }> = {
  ApplicationOpen: { label: "Not submitted", tone: "neutral" },
  Pending: { label: "Under review", tone: "warning" },
  InvitedToInterview: { label: "Interview invite", tone: "accent" },
  InterviewScheduled: { label: "Interview scheduled", tone: "accent" },
  PostInterviewPending: { label: "Decision pending", tone: "accent" },
  Accepted: { label: "Accepted", tone: "success" },
  AcceptedElsewhere: { label: "Placed elsewhere", tone: "neutral" },
  Waitlisted: { label: "Waitlisted", tone: "warning" },
  Rejected: { label: "Not accepted", tone: "neutral" },
  Withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function HiringStatusPill({ status }: { status: string }) {
  const s = HIRING_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Pill size="sm" tone={s.tone}>
      {s.label}
    </Pill>
  );
}
