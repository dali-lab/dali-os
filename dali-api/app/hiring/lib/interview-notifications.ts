import { prisma } from "~/lib/db";

// Emit an in-app Notification to each newly-assigned interviewer so the
// assignment shows up in the bell + Home tasks banner. Recipients dismiss
// it like any other notification (open the link, mark read, or "mark all
// read"); the interview itself stays in their `/interviewer/...` view as
// the persistent record.
//
// Best-effort and runs OUTSIDE the assignment transaction (mirroring
// sendReassignmentEmails): a flaky write here must not roll back a
// committed scheduling change. Callers should `.catch(() => {})` it.
// Safe to call with an empty `cycleInterviewerIds`.

const LOCATION_LABEL: Record<string, string> = {
  PodAppa: "Pod Appa",
  PodMomo: "Pod Momo",
  Online: "Online",
};

function formatStart(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export async function notifyInterviewAssigned(args: {
  interviewId: string;
  cycleInterviewerIds: string[];
  createdByUserId?: string | null;
}): Promise<void> {
  if (args.cycleInterviewerIds.length === 0) return;

  const interview = await prisma.interview.findUnique({
    where: { id: args.interviewId },
    select: {
      id: true,
      startTime: true,
      location: true,
      domainApplication: {
        select: {
          challengeVersion: { select: { domain: { select: { name: true } } } },
          application: {
            select: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });
  if (!interview) return;

  const recipients = await prisma.cycleInterviewer.findMany({
    where: { id: { in: args.cycleInterviewerIds } },
    select: { userId: true },
  });
  if (recipients.length === 0) return;

  const applicant = interview.domainApplication.application.user;
  const applicantName = [applicant.firstName, applicant.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const domain = interview.domainApplication.challengeVersion?.domain?.name ?? null;
  const where = LOCATION_LABEL[interview.location] ?? interview.location;
  const when = formatStart(interview.startTime);

  const title = applicantName
    ? `Interview assigned: ${applicantName}`
    : "Interview assigned";
  const body = domain ? `${domain} • ${when} • ${where}` : `${when} • ${where}`;
  const link = `/interviewer/interview/${interview.id}`;

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      recipientUserId: r.userId,
      createdByUserId: args.createdByUserId ?? null,
      kind: "General" as const,
      title,
      body,
      link,
      dueAt: interview.startTime,
    })),
  });
}
