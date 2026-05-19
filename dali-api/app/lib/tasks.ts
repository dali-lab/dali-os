import { prisma } from "~/lib/db";

// A "task" (todo) is an action-needed notification. Two sources, deliberately
// scoped narrower than the notification feed so the Tasks sidebar, Home banner,
// and sidebar count stay in agreement:
//
//   1. Meeting invites awaiting a response:
//      - kind === MeetingInvite, has scheduledMeetingId, rsvp null, readAt null
//   2. Admin announcement-todos awaiting action:
//      - kind === SystemAnnouncement, isTodo === true, readAt null
//
// Both surface as a `Task`. `dueAt` carries the deadline (the meeting time for
// invites, the admin-set due date for announcement-todos) so the Home banner
// renders one consistent deadline chip. `link` is where acting on the task
// takes you (the meeting/RSVP target, or an attached form's fill page).

export type Task = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  // "meeting" = awaiting RSVP; "announcement" = admin todo.
  source: "meeting" | "announcement";
  // Resolvable deadline (meeting time / admin due date), or null.
  dueAt: string | null;
};

const MEETING_TASK_WHERE = (userId: string) =>
  ({
    recipientUserId: userId,
    kind: "MeetingInvite" as const,
    rsvp: null,
    readAt: null,
    scheduledMeetingId: { not: null },
  });

const ANNOUNCEMENT_TASK_WHERE = (userId: string) =>
  ({
    recipientUserId: userId,
    kind: "SystemAnnouncement" as const,
    isTodo: true,
    readAt: null,
  });

/** Count of open tasks for a user. Cheap — used by the sidebar poller. */
export async function countOpenTasks(userId: string): Promise<number> {
  const [meetings, announcements] = await Promise.all([
    prisma.notification.count({ where: MEETING_TASK_WHERE(userId) }),
    prisma.notification.count({ where: ANNOUNCEMENT_TASK_WHERE(userId) }),
  ]);
  return meetings + announcements;
}

/** Open tasks for a user, newest first, with deadlines resolved. */
export async function listOpenTasks(userId: string): Promise<Task[]> {
  const [meetings, announcements] = await Promise.all([
    prisma.notification.findMany({
      where: MEETING_TASK_WHERE(userId),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        link: true,
        createdAt: true,
        scheduledMeeting: { select: { selectedAt: true } },
      },
    }),
    prisma.notification.findMany({
      where: ANNOUNCEMENT_TASK_WHERE(userId),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        link: true,
        dueAt: true,
        createdAt: true,
        // Attached published form, if any — link the recipient straight to it.
        form: { select: { published: true, publicToken: true } },
      },
    }),
  ]);

  const meetingTasks: Task[] = meetings.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    link: n.link,
    createdAt: n.createdAt.toISOString(),
    source: "meeting",
    dueAt: n.scheduledMeeting?.selectedAt
      ? n.scheduledMeeting.selectedAt.toISOString()
      : null,
  }));

  const announcementTasks: Task[] = announcements.map((n) => {
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
      // Prefer the attached form's fill page, else the notification's own link.
      link: formLink ?? n.link,
      createdAt: n.createdAt.toISOString(),
      source: "announcement",
      dueAt: n.dueAt ? n.dueAt.toISOString() : null,
    };
  });

  // Merge newest-first across both sources.
  return [...meetingTasks, ...announcementTasks].sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  );
}
