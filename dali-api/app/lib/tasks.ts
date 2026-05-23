import { prisma } from "~/lib/db";

// A "task" (todo) is any unread notification — every NotificationKind counts.
// The Tasks sidebar, Home attention banner, and sidebar count all read this
// single predicate so they never disagree. Reading a notification (RSVPing,
// opening its link, submitting the attached form, or hitting "mark all read")
// clears it from tasks.
//
//   kind === MeetingInvite      → "meeting"      (carries RSVP target)
//   kind === MeetingReminder    → "reminder"     (calendar fan-out)
//   kind === SystemAnnouncement → "announcement" (admin-sent; may have form)
//   kind === General            → "general"      (everything else)
//
// `dueAt` is the deadline chip on the Home banner. Sources, in order:
//   - MeetingInvite / MeetingReminder: the meeting's selectedAt
//   - SystemAnnouncement: Notification.dueAt (admin-set)
//   - General: Notification.dueAt if present, else null
//
// `link` is where acting on the task takes you, preferring an attached form's
// fill page (announcement-todos) over the notification's own link.

export type Task = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  source: "meeting" | "reminder" | "announcement" | "general";
  dueAt: string | null;
};

const TASK_WHERE = (userId: string) =>
  ({
    recipientUserId: userId,
    readAt: null,
  });

/** Count of open tasks for a user. Cheap — used by the sidebar poller. */
export async function countOpenTasks(userId: string): Promise<number> {
  return prisma.notification.count({ where: TASK_WHERE(userId) });
}

/** Open tasks for a user, newest first, with deadlines resolved. */
export async function listOpenTasks(userId: string): Promise<Task[]> {
  const rows = await prisma.notification.findMany({
    where: TASK_WHERE(userId),
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
  });

  return rows.map((n) => {
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
}
