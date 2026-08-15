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

const LOCATION_LABEL: Record<string, string> = {
  PodAppa: "Pod Appa",
  PodMomo: "Pod Momo",
  Online: "Online",
};

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
          location: true,
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
    message: { title: "Interview assigned" },
    recipients: assignments.map((a) => {
      const applicant = a.interview.domainApplication.application.user;
      const applicantName = [applicant.firstName, applicant.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const domain = a.interview.domainApplication.domain?.name ?? null;
      const where = LOCATION_LABEL[a.interview.location] ?? a.interview.location;
      // The interviewer is a logged-in member — show the start in their own zone.
      const when = formatInstantWithZoneLabel(
        a.interview.startTime,
        resolveUserTimeZone(a.cycleInterviewer.user),
      );
      return {
        userId: a.cycleInterviewer.userId,
        title: applicantName ? `Interview assigned: ${applicantName}` : "Interview assigned",
        body: domain ? `${domain} • ${when} • ${where}` : `${when} • ${where}`,
        link: `/hiring/interviews/${a.interview.id}`,
        dueAt: a.interview.startTime,
        interviewAssignmentId: a.id,
      };
    }),
  });
}
