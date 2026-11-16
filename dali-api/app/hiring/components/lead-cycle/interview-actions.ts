import { canOverrideAvailability, type InterviewerAvailability } from "~/hiring/lib/interviewer-pool";

export interface ConfirmDialog {
  confirm(opts: {
    title: string;
    description: string;
    confirmLabel: string;
    tone?: "destructive";
  }): Promise<boolean>;
}

export interface ErrorToast {
  error(message: string): void;
}

export interface ReassignTarget {
  id: string;
  name: string;
  availability: InterviewerAvailability;
}

export async function reassignInterviewer({
  interview,
  assignment,
  to,
  dialog,
  toast,
  refresh,
}: {
  interview: { id: string };
  assignment: { id: string };
  to: ReassignTarget;
  dialog: ConfirmDialog;
  toast: ErrorToast;
  refresh: () => Promise<unknown> | unknown;
}) {
  const override = canOverrideAvailability(to.availability);
  const conflict =
    to.availability === "busy"
      ? `${to.name}'s calendar shows a conflict at this time.`
      : `${to.name} has no calendar or working hours set up, so DALI OS can't tell if they're free.`;
  const confirmed = await dialog.confirm({
    title: override ? `Assign ${to.name} anyway?` : "Reassign interviewer?",
    description: override
      ? `${conflict} Check with them first. Emails the removed interviewer and ${to.name} about the change.`
      : "Emails the removed interviewer and the replacement interviewer about the change.",
    confirmLabel: override ? "Assign anyway" : "Reassign",
    tone: "destructive",
  });
  if (!confirmed) return;
  const res = await fetch(`/api/hiring/interviews/${interview.id}/reassign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId: assignment.id, newCycleInterviewerId: to.id, ...(override && { override: true }) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    toast.error(body.error ?? "Failed to reassign interviewer");
    return;
  }
  await refresh();
}
