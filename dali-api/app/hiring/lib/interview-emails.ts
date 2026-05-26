// Sends ICS calendar invite emails for interview booking, rescheduling, and cancellation.
// Email bodies come from per-cycle CycleNotificationEmail template bindings — no binding = no email.
// All sends are best-effort — failures are logged but never block the booking flow.

import type { NotificationType } from "~/generated/prisma/enums";
import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { type InterpolationVars } from "~/lib/email";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, notificationSlot } from "./email-variables";
import { buildInviteIcs, buildCancelIcs, type IcsAttendee } from "./interview-ics";

const ORGANIZER: IcsAttendee = {
  email: "applications@dali.dartmouth.edu",
  name: "DALI Lab",
};

function formatLocation(location: string, meetingUrl?: string | null): string {
  if (location === "PodAppa") return "Pod Appa, DALI Lab";
  if (location === "PodMomo") return "Pod Momo, DALI Lab";
  return meetingUrl ? `Online — ${meetingUrl}` : "Online";
}

function formatTime(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }) + " ET";
}

async function getGmailRefreshToken(): Promise<string | null> {
  return getApplicationsGmailRefreshToken();
}

interface Recipient {
  email: string;
  firstName: string;
}

async function getApplicantRecipient(domainApplicationId: string): Promise<Recipient | null> {
  const da = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: {
      application: {
        include: {
          user: { select: { firstName: true, dartmouthEmail: true, netId: true } },
        },
      },
    },
  });
  const user = da?.application.user;
  if (!user) return null;
  const email = user.dartmouthEmail ?? (user.netId ? `${user.netId}@dartmouth.edu` : null);
  if (!email) return null;
  return { email, firstName: user.firstName };
}

async function getInterviewerRecipients(interviewId: string): Promise<Recipient[]> {
  const assignments = await prisma.interviewAssignment.findMany({
    where: { interviewId, status: "Active" },
    include: {
      cycleInterviewer: {
        include: { user: { select: { firstName: true, daliEmail: true } } },
      },
    },
  });

  return assignments
    .map((a) => {
      const user = a.cycleInterviewer.user;
      const email = user?.daliEmail ?? null;
      const firstName = user?.firstName ?? "Interviewer";
      if (!email) return null;
      return { email, firstName };
    })
    .filter((r): r is Recipient => r !== null);
}

// Atomically bumps the persistent ICS SEQUENCE counter and returns the new
// value. Call before generating an update / cancel ICS so the publish
// receives a sequence strictly greater than the previous one — required by
// RFC 5545 for receiving calendars to apply the update instead of treating
// the new ICS as a duplicate.
async function bumpIcsSequence(interviewId: string): Promise<number> {
  const updated = await prisma.interview.update({
    where: { id: interviewId },
    data: { icsSequence: { increment: 1 } },
    select: { icsSequence: true },
  });
  return updated.icsSequence;
}

async function renderFromBinding(
  applicationCycleId: string,
  notificationType: NotificationType,
  vars: InterpolationVars,
): Promise<{ subject: string; html: string } | null> {
  const binding = await prisma.cycleNotificationEmail.findUnique({
    where: {
      applicationCycleId_notificationType: {
        applicationCycleId,
        notificationType,
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding) return null;
  return renderForSlot(notificationSlot(notificationType), binding.emailTemplateVersion, vars);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function sendInterviewInviteEmails(
  interviewId: string,
  domainApplicationId: string,
): Promise<void> {
  try {
    const refreshToken = await getGmailRefreshToken();
    if (!refreshToken) return;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { challengeVersion: { include: { domain: { select: { name: true } } } } },
    });
    const domainName = da?.challengeVersion?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl ?? undefined,
    };

    const applicant = await getApplicantRecipient(domainApplicationId);
    const interviewers = await getInterviewerRecipients(interviewId);

    // Two distinct ICS objects so the applicant's calendar guest list shows
    // ONLY themselves while the interviewers get the joint view. Same UID
    // (derived from interviewId), so per-account RSVP replies still reconcile
    // to the same logical event on the organizer side.
    const applicantAttendee: IcsAttendee[] = applicant
      ? [{ email: applicant.email, name: applicant.firstName }]
      : [];
    const interviewerAttendees: IcsAttendee[] = interviewers.map((i) => ({
      email: i.email,
      name: i.firstName,
    }));
    const icsCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl,
      organizer: ORGANIZER,
      // Initial REQUEST uses the row's current sequence (0 for a fresh
      // interview). No bump here — bumps happen on updates / cancels.
      sequence: interview.icsSequence,
    } as const;
    const applicantIcs = buildInviteIcs({ ...icsCommon, attendees: applicantAttendee });
    const interviewerIcs = buildInviteIcs({
      ...icsCommon,
      attendees: [...applicantAttendee, ...interviewerAttendees],
    });

    const sends: Promise<any>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewConfirmedApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: applicant.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: applicantIcs,
        }));
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewInviteMentor",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: interviewer.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: interviewerIcs,
        }));
      }
    }

    await Promise.allSettled(sends);
  } catch (err) {
    console.error("Failed to send interview invite emails:", err);
  }
}

export async function sendInterviewCancelEmails(
  interviewId: string,
  domainApplicationId: string,
): Promise<void> {
  try {
    const refreshToken = await getGmailRefreshToken();
    if (!refreshToken) return;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { challengeVersion: { include: { domain: { select: { name: true } } } } },
    });
    const domainName = da?.challengeVersion?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, interview.zoomJoinUrl),
    };

    const applicant = await getApplicantRecipient(domainApplicationId);
    const interviewers = await getInterviewerRecipients(interviewId);

    // Per-recipient ICS so the applicant's cancellation only lists themselves.
    // See sendInterviewInviteEmails for the rationale.
    const applicantAttendee: IcsAttendee[] = applicant
      ? [{ email: applicant.email, name: applicant.firstName }]
      : [];
    const interviewerAttendees: IcsAttendee[] = interviewers.map((i) => ({
      email: i.email,
      name: i.firstName,
    }));
    // Bump first so the CANCEL's SEQUENCE is strictly greater than the
    // previous REQUEST's — required for receiving calendars to actually drop
    // the event instead of treating the CANCEL as stale.
    const sequence = await bumpIcsSequence(interview.id);

    const icsCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      organizer: ORGANIZER,
      sequence,
    } as const;
    const applicantIcs = buildCancelIcs({ ...icsCommon, attendees: applicantAttendee });
    const interviewerIcs = buildCancelIcs({
      ...icsCommon,
      attendees: [...applicantAttendee, ...interviewerAttendees],
    });

    const sends: Promise<any>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewCancelledApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: applicant.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: applicantIcs,
        }));
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewCancelledInterviewer",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: interviewer.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: interviewerIcs,
        }));
      }
    }

    await Promise.allSettled(sends);
  } catch (err) {
    console.error("Failed to send interview cancel emails:", err);
  }
}

export async function sendReassignmentEmails(
  interviewId: string,
  domainApplicationId: string,
  removedCycleInterviewerId: string,
  newCycleInterviewerId: string,
): Promise<void> {
  try {
    const refreshToken = await getGmailRefreshToken();
    if (!refreshToken) return;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { challengeVersion: { include: { domain: { select: { name: true } } } } },
    });
    const domainName = da?.challengeVersion?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl ?? undefined,
    };

    // Bump once for the whole reassignment so the CANCEL to the removed
    // interviewer and the REQUEST(update) to everyone else share the same
    // SEQUENCE (both strictly greater than the previous publish).
    const sequence = await bumpIcsSequence(interview.id);

    const sends: Promise<any>[] = [];

    // Cancel ICS to removed interviewer
    const removedCI = await prisma.cycleInterviewer.findUnique({
      where: { id: removedCycleInterviewerId },
      include: { user: { select: { firstName: true, daliEmail: true } } },
    });
    if (removedCI?.user.daliEmail) {
      const removedName = removedCI.user.firstName ?? "Interviewer";
      const cancelIcs = buildCancelIcs({
        interviewId: interview.id,
        summary: `DALI Interview — ${domainName}`,
        startTime: interview.startTime,
        endTime: interview.endTime,
        organizer: ORGANIZER,
        attendees: [{ email: removedCI.user.daliEmail, name: removedName }],
        sequence,
      });
      const firstName = removedName;
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewCancelledInterviewer",
        { firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: removedCI.user.daliEmail,
          subject: rendered.subject,
          html: rendered.html,
          ics: cancelIcs,
        }));
      }
    }

    // REQUEST(update) to everyone STILL on the interview: applicant +
    // unchanged interviewers + the newly-added interviewer. Same SEQUENCE
    // for all so unchanged participants' calendars accept the update and
    // re-render the guest list (departed interviewer removed). The new
    // interviewer's calendar treats this UID as a fresh event and adds it.
    //
    // getInterviewerRecipients reads InterviewAssignment.status="Active",
    // which the reassign endpoint has already updated by the time we run:
    // the removed assignment is "Replaced" and the new one is "Active".
    const applicant = await getApplicantRecipient(domainApplicationId);
    const currentInterviewers = await getInterviewerRecipients(interviewId);
    const applicantAttendee: IcsAttendee[] = applicant
      ? [{ email: applicant.email, name: applicant.firstName }]
      : [];
    const interviewerAttendees: IcsAttendee[] = currentInterviewers.map((i) => ({
      email: i.email,
      name: i.firstName,
    }));
    const updateCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl,
      organizer: ORGANIZER,
      sequence,
    } as const;
    const applicantIcs = buildInviteIcs({ ...updateCommon, attendees: applicantAttendee });
    const interviewerIcs = buildInviteIcs({
      ...updateCommon,
      attendees: [...applicantAttendee, ...interviewerAttendees],
    });

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewConfirmedApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: applicant.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: applicantIcs,
        }));
      }
    }

    for (const interviewer of currentInterviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewInviteMentor",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: interviewer.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: interviewerIcs,
        }));
      }
    }

    await Promise.allSettled(sends);
  } catch (err) {
    console.error("Failed to send reassignment emails:", err);
  }
}

// Targeted backfill: send the "you're now the interviewer" invite to a
// single CycleInterviewer for an existing interview. Used by the
// resend-decline-invites script to repair decline-auto-reassigns that
// completed before PR #702 wired up sendReassignmentEmails. Refuses to send
// for past interviews or interviews that aren't Scheduled (Completed,
// Cancelled*) — there's nothing to add to the recipient's calendar.
// Does NOT email the applicant, co-interviewers, or the original decliner.
export async function sendInviteEmailToNewInterviewer(
  interviewId: string,
  cycleInterviewerId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const refreshToken = await getGmailRefreshToken();
  if (!refreshToken) return { sent: false, reason: "no_refresh_token" };

  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      domainApplication: {
        include: {
          challengeVersion: { include: { domain: { select: { name: true } } } },
        },
      },
    },
  });
  if (!interview) return { sent: false, reason: "interview_not_found" };
  if (interview.status !== "Scheduled") {
    return { sent: false, reason: `interview_status_${interview.status}` };
  }
  if (interview.endTime.getTime() < Date.now()) {
    return { sent: false, reason: "interview_in_past" };
  }

  const newCI = await prisma.cycleInterviewer.findUnique({
    where: { id: cycleInterviewerId },
    include: { user: { select: { firstName: true, daliEmail: true } } },
  });
  if (!newCI?.user.daliEmail) return { sent: false, reason: "no_dali_email" };

  const applicant = await getApplicantRecipient(interview.domainApplicationId);
  const sequence = await bumpIcsSequence(interview.id);
  const domainName = interview.domainApplication.challengeVersion?.domain?.name ?? "DALI Lab";
  const firstName = newCI.user.firstName ?? "Interviewer";

  const ics = buildInviteIcs({
    interviewId: interview.id,
    summary: `DALI Interview — ${domainName}`,
    startTime: interview.startTime,
    endTime: interview.endTime,
    location: formatLocation(interview.location, interview.zoomJoinUrl),
    meetingUrl: interview.zoomJoinUrl,
    organizer: ORGANIZER,
    attendees: [
      ...(applicant ? [{ email: applicant.email, name: applicant.firstName }] : []),
      { email: newCI.user.daliEmail, name: firstName },
    ],
    sequence,
  });

  const rendered = await renderFromBinding(
    interview.applicationCycleId,
    "InterviewInviteMentor",
    {
      firstName,
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl ?? undefined,
    },
  );
  if (!rendered) return { sent: false, reason: "no_template_binding" };

  await sendEmail({
    refreshToken,
    to: newCI.user.daliEmail,
    subject: rendered.subject,
    html: rendered.html,
    ics,
  });
  return { sent: true };
}

export async function sendLocationChangeEmails(
  interviewId: string,
  domainApplicationId: string,
): Promise<void> {
  try {
    const refreshToken = await getGmailRefreshToken();
    if (!refreshToken) return;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { challengeVersion: { include: { domain: { select: { name: true } } } } },
    });
    const domainName = da?.challengeVersion?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl ?? undefined,
    };

    const applicant = await getApplicantRecipient(domainApplicationId);
    const interviewers = await getInterviewerRecipients(interviewId);

    // Per-recipient ICS so the applicant only sees themselves in the updated
    // event. See sendInterviewInviteEmails for rationale.
    const applicantAttendee: IcsAttendee[] = applicant
      ? [{ email: applicant.email, name: applicant.firstName }]
      : [];
    const interviewerAttendees: IcsAttendee[] = interviewers.map((i) => ({
      email: i.email,
      name: i.firstName,
    }));
    // Bump first so the update's SEQUENCE is strictly greater than the
    // previous publish — without this Google Calendar treats the new ICS as
    // a duplicate and the location change silently doesn't propagate.
    const sequence = await bumpIcsSequence(interview.id);

    const icsCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl,
      description: "Updated location",
      organizer: ORGANIZER,
      sequence,
    } as const;
    const applicantIcs = buildInviteIcs({ ...icsCommon, attendees: applicantAttendee });
    const interviewerIcs = buildInviteIcs({
      ...icsCommon,
      attendees: [...applicantAttendee, ...interviewerAttendees],
    });

    const sends: Promise<any>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewLocationChanged",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: applicant.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: applicantIcs,
        }));
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewLocationChanged",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: interviewer.email,
          subject: rendered.subject,
          html: rendered.html,
          ics: interviewerIcs,
        }));
      }
    }

    await Promise.allSettled(sends);
  } catch (err) {
    console.error("Failed to send location change emails:", err);
  }
}
