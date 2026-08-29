// Sends ICS calendar invite emails for interview booking, rescheduling, and cancellation.
// Email bodies come from per-cycle CycleNotificationEmail template bindings — no binding = no email.
// All sends are best-effort — failures are logged but never block the booking flow.
// Every send goes through the outbox (app/lib/outbound.server.ts): enqueue +
// inline drain, so delivery gets retry + per-sender cap + history for free.

import type { NotificationType } from "~/generated/prisma/enums";
import { prisma } from "~/lib/db";
import { type InterpolationVars } from "~/lib/email";
import { APPLICATION_TZ, APPLICATION_TZ_LABEL } from "~/lib/timezone";
import { renderForSlot, notificationSlot } from "./email-variables";
import { buildInviteIcs, buildCancelIcs, type IcsAttendee } from "./interview-ics";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";

const ORGANIZER: IcsAttendee = {
  email: "applications@dali.dartmouth.edu",
  name: "DALI Lab",
};

// The interview's video-conference join link for the invite/ICS: the
// auto-provisioned Google Meet URL (app/hiring/lib/interview-meet.ts), falling
// back to a legacy Zoom link if one was ever set.
function meetingLink(iv: { videoUrl: string | null; zoomJoinUrl: string | null }): string | null {
  return iv.videoUrl ?? iv.zoomJoinUrl;
}

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
    timeZone: APPLICATION_TZ,
  }) + ` ${APPLICATION_TZ_LABEL}`;
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

// Reminder emails for the interview-reminders job. Same per-cycle
// CycleNotificationEmail binding flow as every other hiring email — no
// binding = no email for that audience. No ICS — recipients already hold
// the calendar event from the invite. Returns the number of emails enqueued.
export async function sendInterviewReminderEmails(interviewId: string): Promise<number> {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    // Re-check status: the job claims its ledger row first, and the interview
    // may have been cancelled in between.
    if (!interview || interview.status !== "Scheduled") return 0;

    const da = await prisma.domainApplication.findUnique({
      where: { id: interview.domainApplicationId },
      include: { domain: { select: { name: true } } },
    });
    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: da?.domain?.name ?? "DALI Lab",
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview) ?? undefined,
    };

    const applicant = await getApplicantRecipient(interview.domainApplicationId);
    const interviewers = await getInterviewerRecipients(interviewId);

    // No dedupKey: the interview-reminders job already claims an
    // InterviewReminderLog(interviewId, kind) row before calling this, and the
    // 24h + 1h reminders legitimately both send.
    const enqueues: Promise<string | null>[] = [];
    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewReminderApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(
          enqueueOutbound({
            channel: "email",
            purpose: "Hiring",
            target: applicant.email,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            eventType: "hiring.interview.reminder",
          }).then((r) => r.id),
        );
      }
    }
    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewReminderInterviewer",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(
          enqueueOutbound({
            channel: "email",
            purpose: "Hiring",
            target: interviewer.email,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            eventType: "hiring.interview.reminder",
          }).then((r) => r.id),
        );
      }
    }
    const ids = await Promise.all(enqueues);
    await drainNow(ids);
    return ids.filter(Boolean).length;
  } catch (err) {
    console.error("Failed to send interview reminder emails:", err);
    return 0;
  }
}

export async function sendInterviewInviteEmails(
  interviewId: string,
  domainApplicationId: string,
  opts: { dedupKey?: null } = {},
): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { domain: { select: { name: true } } },
    });
    const domainName = da?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview) ?? undefined,
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
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview),
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

    // Whether to use a stable dedupKey (initial invite) or omit it (intentional
    // resend). Caller passes opts.dedupKey=null for resends.
    const useDedup = !("dedupKey" in opts);

    const enqueues: Promise<string | null>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewConfirmedApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(
          enqueueOutbound({
            channel: "email",
            purpose: "Hiring",
            dedupKey: useDedup
              ? `hiring.interview.invite:${interviewId}:${applicant.email.toLowerCase()}`
              : null,
            target: applicant.email,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            ics: applicantIcs,
            eventType: "hiring.interview.invite",
          }).then(({ id }) => id),
        );
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewInviteMentor",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(
          enqueueOutbound({
            channel: "email",
            purpose: "Hiring",
            dedupKey: useDedup
              ? `hiring.interview.invite:${interviewId}:${interviewer.email.toLowerCase()}`
              : null,
            target: interviewer.email,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            ics: interviewerIcs,
            eventType: "hiring.interview.invite",
          }).then(({ id }) => id),
        );
      }
    }

    const ids = await Promise.all(enqueues);
    await drainNow(ids);
  } catch (err) {
    console.error("Failed to send interview invite emails:", err);
  }
}

export async function sendInterviewCancelEmails(
  interviewId: string,
  domainApplicationId: string,
): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { domain: { select: { name: true } } },
    });
    const domainName = da?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, meetingLink(interview)),
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

    // Terminal event → forever dedupKey per recipient (dedups a double-cancel).
    const enqueues: Promise<string | null>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewCancelledApplicant",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          dedupKey: `hiring.interview.cancel:${interviewId}:${applicant.email.toLowerCase()}`,
          target: applicant.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: applicantIcs,
          eventType: "hiring.interview.cancel",
        }).then((r) => r.id));
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewCancelledInterviewer",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          dedupKey: `hiring.interview.cancel:${interviewId}:${interviewer.email.toLowerCase()}`,
          target: interviewer.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: interviewerIcs,
          eventType: "hiring.interview.cancel",
        }).then((r) => r.id));
      }
    }

    await drainNow(await Promise.all(enqueues));
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
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { domain: { select: { name: true } } },
    });
    const domainName = da?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview) ?? undefined,
    };

    // Bump once for the whole reassignment so the CANCEL to the removed
    // interviewer and the REQUEST(update) to everyone else share the same
    // SEQUENCE (both strictly greater than the previous publish).
    const sequence = await bumpIcsSequence(interview.id);

    // No dedupKey: reassignments legitimately recur (A→B→C).
    const enqueues: Promise<string | null>[] = [];

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
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          target: removedCI.user.daliEmail,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: cancelIcs,
          eventType: "hiring.interview.reassignment",
        }).then((r) => r.id));
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
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview),
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
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          target: applicant.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: applicantIcs,
          eventType: "hiring.interview.reassignment",
        }).then((r) => r.id));
      }
    }

    for (const interviewer of currentInterviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewInviteMentor",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          target: interviewer.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: interviewerIcs,
          eventType: "hiring.interview.reassignment",
        }).then((r) => r.id));
      }
    }

    await drainNow(await Promise.all(enqueues));
  } catch (err) {
    console.error("Failed to send reassignment emails:", err);
  }
}

export async function sendLocationChangeEmails(
  interviewId: string,
  domainApplicationId: string,
): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return;

    const da = await prisma.domainApplication.findUnique({
      where: { id: domainApplicationId },
      include: { domain: { select: { name: true } } },
    });
    const domainName = da?.domain?.name ?? "DALI Lab";

    const baseVars: Omit<InterpolationVars, "firstName"> = {
      domain: domainName,
      time: formatTime(interview.startTime),
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview) ?? undefined,
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
      location: formatLocation(interview.location, meetingLink(interview)),
      meetingUrl: meetingLink(interview),
      description: "Updated location",
      organizer: ORGANIZER,
      sequence,
    } as const;
    const applicantIcs = buildInviteIcs({ ...icsCommon, attendees: applicantAttendee });
    const interviewerIcs = buildInviteIcs({
      ...icsCommon,
      attendees: [...applicantAttendee, ...interviewerAttendees],
    });

    // No dedupKey: the location can change repeatedly.
    const enqueues: Promise<string | null>[] = [];

    if (applicant) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewLocationChanged",
        { firstName: applicant.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          target: applicant.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: applicantIcs,
          eventType: "hiring.interview.location",
        }).then((r) => r.id));
      }
    }

    for (const interviewer of interviewers) {
      const rendered = await renderFromBinding(
        interview.applicationCycleId,
        "InterviewLocationChanged",
        { firstName: interviewer.firstName, ...baseVars },
      );
      if (rendered) {
        enqueues.push(enqueueOutbound({
          channel: "email",
          purpose: "Hiring",
          target: interviewer.email,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          ics: interviewerIcs,
          eventType: "hiring.interview.location",
        }).then((r) => r.id));
      }
    }

    await drainNow(await Promise.all(enqueues));
  } catch (err) {
    console.error("Failed to send location change emails:", err);
  }
}
