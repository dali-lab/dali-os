import { useState } from "react";
import { cn } from "~/lib/cn";
import { hiringKey } from "~/email/lib/registry";
import { EmailEditorModal } from "~/admin/components/EmailTemplatesAdmin";
import { Link } from "react-router";
import { CONTINUED_INTEREST_SLOT, LATER_INTERVIEW_INVITE_SLOT, type TemplateSlot, type DecisionSlotType, type NotificationSlotType } from "~/hiring/lib/email-variables";
import { Modal } from "~/components/Modal";
import { X } from "lucide-react";
import { SetupCard } from "~/hiring/components/cycle-setup/SetupCard";

type PreviewCriterion = { key: string; label: string; maxScore?: number; description?: string };

export function RubricPreviewModal({ rv, onClose }: {
  rv: { id: string; versionNumber: number; rubric?: { name: string } | null; criteria: unknown };
  onClose: () => void;
}) {
  const headingId = `rubric-preview-heading-${rv.id}`;
  const criteria = (Array.isArray(rv.criteria) ? rv.criteria : []) as PreviewCriterion[];
  return (
    <Modal open onClose={onClose} labelledBy={headingId} containerClassName="bg-card rounded-os-card shadow-xl max-w-lg w-full mx-4 p-5 max-h-[80vh] overflow-y-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id={headingId} className="text-lg font-bold text-foreground">
            {rv.rubric?.name ?? 'Rubric'} — v{rv.versionNumber}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">No criteria in this version.</p>
        ) : (
          <div className="space-y-3">
            {criteria.map((c) => (
              <div key={c.key} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-foreground">{c.label}</h4>
                  <span className="text-xs text-muted-foreground">Max: {c.maxScore}</span>
                </div>
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export const DECISION_EMAIL_SLOTS: ReadonlyArray<{ type: DecisionSlotType; label: string; description: string }> = [
  { type: "Rejected", label: "Rejected", description: "Sent when a rejection is released." },
  { type: "InvitedToInterview", label: "Invited to interview", description: "Sent when an interview invite is released." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is waitlisted." },
  { type: "Accepted", label: "Accepted", description: "Sent when an offer is released." },
];

export const LATER_INTERVIEW_INVITE_EMAIL_SLOT = {
  label: "Invited to a later interview round",
  description: "Sent when an invite to a second or later interview round is released.",
  templateSlot: LATER_INTERVIEW_INVITE_SLOT,
} as const;

export const CONTINUED_INTEREST_EMAIL_SLOT = {
  label: "Removed from waitlist",
  description: "Sent when Core removes someone from the waitlist. Invites them to reapply with continued interest.",
  templateSlot: CONTINUED_INTEREST_SLOT,
} as const;

export function EmailStatusSection({
  title,
  description,
  slots,
  hiringEmails,
  canEdit,
}: {
  title: string;
  description: string;
  slots: ReadonlyArray<{ label: string; description: string; templateSlot: TemplateSlot }>;
  hiringEmails: Record<string, { subject: string; body: string }>;
  /** The viewer is Core, so a row opens Core's editor on that email. */
  canEdit: boolean;
}) {
  // No editor of its own, on purpose. These emails are shared by every cycle, so
  // editing them belongs to Core, not to whoever happens to administer this
  // cycle. A Core viewer's rows open Core's editor here, in place; for everyone
  // else the Setup tab still answers "is it written?", because releasing a
  // decision with no email written fails.
  const [editing, setEditing] = useState<TemplateSlot | null>(null);
  return (
    <SetupCard title={title} description={description}>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const email = hiringEmails[slot.templateSlot] ?? null;
          const rowClass = "flex items-start gap-3 rounded-lg border border-border p-3";
          const body = (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{slot.label}</span>
                {email ? null : (
                  <span className="text-xs text-os-amber">
                    No email yet
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{slot.description}</p>
              {email ? (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  Subject: {email.subject}
                </p>
              ) : null}
            </div>
          );
          return canEdit ? (
            <button
              key={slot.templateSlot}
              type="button"
              onClick={() => setEditing(slot.templateSlot)}
              aria-label={`Edit ${slot.label} email`}
              className={cn(rowClass, "w-full text-left transition-colors hover:bg-muted")}
            >
              {body}
            </button>
          ) : (
            <div key={slot.templateSlot} className={rowClass}>
              {body}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Shared by every cycle.{" "}
          <Link to="/core/communications/email" className="underline">
            See all in Core &rarr; Communications &rarr; Email
          </Link>
          .
        </p>
      </div>
      {editing && (
        <EmailEditorModal templateKey={hiringKey(editing)} onClose={() => setEditing(null)} />
      )}
    </SetupCard>
  );
}

export const NOTIFICATION_EMAIL_SLOTS: ReadonlyArray<{ type: NotificationSlotType; label: string; description: string }> = [
  { type: "ApplicationReceived", label: "Application received", description: "Sent when an applicant first submits." },
  { type: "ApplicationExtensionNotice", label: "Deadline extension notice", description: "Sent once to unsubmitted applicants after the original close." },
  { type: "ApplicationEventAnnouncement", label: "Application event announcement", description: "Sent by hand from an event card to everyone who started an application." },
  { type: "DomainAddedNotice", label: "Domain added to an open cycle", description: "Sent by hand from a domain row, once per domain, to everyone with a non-Withdrawn application." },
  { type: "InterviewInviteMentor", label: "Interview invite (interviewer)", description: "Sent when an interview is booked or reassigned." },
  { type: "InterviewInterviewerChanged", label: "Co-interviewer changed (interviewer)", description: "Sent to the interviewer who stays on when the other one changes. Uses the invite above if left empty." },
  { type: "InterviewInviteReminder", label: "Invite reminder (applicant)", description: "Sent by Resend invite when an applicant hasn't booked." },
  { type: "InterviewConfirmedApplicant", label: "Interview confirmed (applicant)", description: "Sent when the applicant books." },
  { type: "InterviewCancelledApplicant", label: "Interview cancelled (applicant)", description: "Sent when the interview is cancelled." },
  { type: "InterviewCancelledByTeamApplicant", label: "Interview cancelled by the team (applicant)", description: "Sent when a hiring lead cancels; tells the applicant to book a new time." },
  { type: "InterviewCancelledInterviewer", label: "Interview cancelled (interviewer)", description: "Sent when an interview is cancelled or reassigned away." },
  { type: "InterviewLocationChanged", label: "Interview location changed", description: "Sent to everyone when the location changes." },
  { type: "InterviewReminderApplicant", label: "Interview reminder (applicant)", description: "Sent 24 hours and 1 hour before the interview." },
  { type: "InterviewReminderInterviewer", label: "Interview reminder (interviewer)", description: "Sent 24 hours and 1 hour before the interview." },
];
