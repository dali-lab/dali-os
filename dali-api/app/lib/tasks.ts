import { prisma } from "~/lib/db";

// A "task" (todo) has two sources:
//
//   1. Any unread Notification owned by the user. Reading the notification
//      (RSVPing, opening its link, submitting the attached form, or hitting
//      "mark all read") clears it from tasks.
//        kind === MeetingInvite      → "meeting"      (carries RSVP target)
//        kind === MeetingReminder    → "reminder"     (calendar fan-out)
//        kind === SystemAnnouncement → "announcement" (admin-sent; may have form)
//        kind === General            → "general"      (everything else)
//
//   2. Every InterviewAssignment (Active) on a Scheduled, not-yet-ended
//      Interview the user is assigned to as interviewer. These don't have
//      an explicit "read" — they clear automatically when the interview
//      completes, is cancelled, or the assignment is declined/replaced.
//      Source value: "interview". Link: /interviewer/interview/<id>.
//
// The Tasks sidebar, Home attention banner, and sidebar count all read these
// helpers so they never disagree.
//
// `dueAt` is the deadline chip on the Home banner. Sources, in order:
//   - MeetingInvite / MeetingReminder: the meeting's selectedAt
//   - SystemAnnouncement: Notification.dueAt (admin-set)
//   - General: Notification.dueAt if present, else null
//   - Interview: the interview's startTime
//
// `link` is where acting on the task takes you, preferring an attached form's
// fill page (announcement-todos) over the notification's own link.

export type Task = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  source: "meeting" | "reminder" | "announcement" | "general" | "interview";
  dueAt: string | null;
};

const NOTIFICATION_TASK_WHERE = (userId: string) =>
  ({
    recipientUserId: userId,
    readAt: null,
  });

const interviewAssignmentTaskWhere = (userId: string, now: Date) =>
  ({
    status: "Active" as const,
    cycleInterviewer: { userId },
    interview: {
      status: "Scheduled" as const,
      endTime: { gt: now },
    },
  });

/** Count of open tasks for a user. Cheap — used by the sidebar poller. */
export async function countOpenTasks(userId: string): Promise<number> {
  const now = new Date();
  const [notifs, interviews] = await Promise.all([
    prisma.notification.count({ where: NOTIFICATION_TASK_WHERE(userId) }),
    prisma.interviewAssignment.count({
      where: interviewAssignmentTaskWhere(userId, now),
    }),
  ]);
  return notifs + interviews;
}

/** Open tasks for a user, newest first, with deadlines resolved. */
export async function listOpenTasks(userId: string): Promise<Task[]> {
  const now = new Date();
  const [notifRows, assignmentRows] = await Promise.all([
    prisma.notification.findMany({
      where: NOTIFICATION_TASK_WHERE(userId),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        dueAt: true,
        createdAt: true,
        scheduledMeeting: { select: { selectedAt: true } },
        // Attached published form, if any — link the recipient straight to it.
        form: { select: { published: true, publicToken: true } },
      },
    }),
    prisma.interviewAssignment.findMany({
      where: interviewAssignmentTaskWhere(userId, now),
      orderBy: { interview: { startTime: "asc" } },
      select: {
        id: true,
        createdAt: true,
        interview: {
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
        },
      },
    }),
  ]);

  const notifTasks: Task[] = notifRows.map((n) => {
    const source: Task["source"] =
      n.kind === "MeetingInvite"
        ? "meeting"
        : n.kind === "MeetingReminder"
          ? "reminder"
          : n.kind === "SystemAnnouncement"
            ? "announcement"
            : "general";

    const meetingDue = n.scheduledMeeting?.selectedAt?.toISOString() ?? null;
    const dueAt = meetingDue ?? (n.dueAt ? n.dueAt.toISOString() : null);

    // Authenticated fill route (not the public /f/ one): the recipient is a
    // logged-in user, and the authed submit is what marks this todo read so
    // the task clears + the count drops once they submit.
    const formLink =
      n.form?.published && n.form.publicToken
        ? `/forms/fill/${n.form.publicToken}`
        : null;

    return {
      id: n.id,
      title: n.title,
      body: n.body,
      link: formLink ?? n.link,
      createdAt: n.createdAt.toISOString(),
      source,
      dueAt,
    };
  });

  const interviewTasks: Task[] = assignmentRows.map((a) => {
    const applicant = a.interview.domainApplication.application.user;
    const applicantName = [applicant.firstName, applicant.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const domain = a.interview.domainApplication.challengeVersion?.domain?.name ?? null;
    return {
      // Prefix avoids any chance of collision with notification cuids and
      // makes the row stable across the assignment's lifetime.
      id: `interview:${a.interview.id}`,
      title: applicantName
        ? `Interview with ${applicantName}`
        : "Upcoming interview",
      body: domain ? `${domain} • ${a.interview.location}` : a.interview.location,
      link: `/interviewer/interview/${a.interview.id}`,
      createdAt: a.createdAt.toISOString(),
      source: "interview",
      dueAt: a.interview.startTime.toISOString(),
    };
  });

  return [...notifTasks, ...interviewTasks].sort((x, y) =>
    x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0,
  );
}
