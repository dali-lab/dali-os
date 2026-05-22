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
    const icsCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      organizer: ORGANIZER,
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

    // Invite ICS to new interviewer
    const newCI = await prisma.cycleInterviewer.findUnique({
      where: { id: newCycleInterviewerId },
      include: { user: { select: { firstName: true, daliEmail: true } } },
    });
    if (newCI?.user.daliEmail) {
      const applicant = await getApplicantRecipient(domainApplicationId);
      const interviewers = await getInterviewerRecipients(interviewId);
      const inviteIcs = buildInviteIcs({
        interviewId: interview.id,
        summary: `DALI Interview — ${domainName}`,
        startTime: interview.startTime,
        endTime: interview.endTime,
        location: formatLocation(interview.location, interview.zoomJoinUrl),
        meetingUrl: interview.zoomJoinUrl,
        organizer: ORGANIZER,
        attendees: [
          ...(applicant ? [{ email: applicant.email, name: applicant.firstName }] : []),
          ...interviewers.map((i) => ({ email: i.email, name: i.firstName })),
        ],
      });
      const firstName = newCI.user.firstName ?? "Interviewer";
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewInviteMentor",
        { firstName, ...baseVars },
      );
      if (rendered) {
        sends.push(sendEmail({
          refreshToken,
          to: newCI.user.daliEmail,
          subject: rendered.subject,
          html: rendered.html,
          ics: inviteIcs,
        }));
      }
    }

    await Promise.allSettled(sends);
  } catch (err) {
    console.error("Failed to send reassignment emails:", err);
  }
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
    const icsCommon = {
      interviewId: interview.id,
      summary: `DALI Interview — ${domainName}`,
      startTime: interview.startTime,
      endTime: interview.endTime,
      location: formatLocation(interview.location, interview.zoomJoinUrl),
      meetingUrl: interview.zoomJoinUrl,
      description: "Updated location",
      organizer: ORGANIZER,
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
