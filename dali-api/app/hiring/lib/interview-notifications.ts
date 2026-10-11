import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { formatInstantWithZoneLabel, resolveUserTimeZone } from "~/lib/timezone";

// Emit an in-app Notification to each newly-assigned interviewer so the
// assignment shows up in the bell + Home tasks banner. The notification
// is linked to its InterviewAssignment via Notification.interviewAssignmentId
// — the tasks loader hides it once that assignment is no longer Active or
// the interview is no longer Scheduled, so reassignments / cancellations
// clear the old interviewer's tile automatically with no fan-out writes.
//
// Recipients can also dismiss it manually like any other notification
// (open the link, mark read, "mark all read"); the interview itself
// stays in their `/interviewer/...` view as the persistent record.
//
// Best-effort and runs OUTSIDE the assignment transaction (mirroring
// sendReassignmentEmails): a flaky write here must not roll back a
// committed scheduling change. Callers should `.catch(() => {})` it.
// Safe to call with an empty `assignmentIds`.

export async function notifyInterviewAssigned(args: {
  assignmentIds: string[];
  createdByUserId?: string | null;
}): Promise<void> {
  if (args.assignmentIds.length === 0) return;

  const assignments = await prisma.interviewAssignment.findMany({
    where: { id: { in: args.assignmentIds } },
    select: {
      id: true,
      cycleInterviewer: {
        select: { userId: true, user: { select: { timeZone: true } } },
      },
      interview: {
        select: {
          id: true,
          startTime: true,
          room: { select: { name: true } },
          domainApplication: {
            select: {
              domain: { select: { name: true } },
              application: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (assignments.length === 0) return;

  await notify({
    eventType: "hiring.interview_assigned",
    createdByUserId: args.createdByUserId ?? null,
    message: {},
    recipients: assignments.map((a) => {
      const applicant = a.interview.domainApplication.application.user;
      const applicantName = [applicant.firstName, applicant.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const domain = a.interview.domainApplication.domain?.name ?? null;
      const where = a.interview.room?.name ?? "Online";
      // The interviewer is a logged-in member — show the start in their own zone.
      const when = formatInstantWithZoneLabel(
        a.interview.startTime,
        resolveUserTimeZone(a.cycleInterviewer.user),
      );
      return {
        userId: a.cycleInterviewer.userId,
        vars: {
          // An applicant with no name on file leaves the template's "{{personName}}"
          // empty rather than rewriting the whole sentence, as the old copy did.
          personName: applicantName,
          itemDetail: domain ? `${domain} • ${when} • ${where}` : `${when} • ${where}`,
        },
        link: `/hiring/interviews/${a.interview.id}`,
        dueAt: a.interview.startTime,
        interviewAssignmentId: a.id,
      };
    }),
  });
}

// A hiring lead cancelled the interview. The assigned-interview tiles clear
// on their own (the tasks loader hides them once the interview isn't
// Scheduled); this tells the two interviewers why. Best-effort, outside the
// cancel transaction; pass the interviewer userIds captured before the
// assignments flipped to Declined.
export async function notifyInterviewCancelled(args: {
  interviewId: string;
  interviewerUserIds: string[];
  createdByUserId?: string | null;
}): Promise<void> {
  if (args.interviewerUserIds.length === 0) return;

  const interview = await prisma.interview.findUnique({
    where: { id: args.interviewId },
    select: {
      startTime: true,
      room: { select: { name: true } },
      domainApplication: {
        select: {
          domain: { select: { name: true } },
          application: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
  if (!interview) return;
  const users = await prisma.user.findMany({
    where: { id: { in: args.interviewerUserIds } },
    select: { id: true, timeZone: true },
  });

  const applicant = interview.domainApplication.application.user;
  const personName = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ").trim();
  const domain = interview.domainApplication.domain?.name ?? null;
  const where = interview.room?.name ?? "Online";

  await notify({
    eventType: "hiring.interview_cancelled",
    createdByUserId: args.createdByUserId ?? null,
    message: {},
    recipients: users.map((u) => {
      const when = formatInstantWithZoneLabel(interview.startTime, resolveUserTimeZone(u));
      return {
        userId: u.id,
        vars: {
          personName,
          itemDetail: `${domain ? `${domain} • ` : ""}${when} • ${where} • cancelled by the hiring lead`,
        },
        link: `/hiring/interviews/${args.interviewId}`,
      };
    }),
  });
}
