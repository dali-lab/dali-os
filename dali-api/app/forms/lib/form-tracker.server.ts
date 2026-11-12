import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { resolveGroupMembers } from "~/lib/groups.server";
import { notify } from "~/lib/notify.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import {
  REMINDER_COOLDOWN_MS,
  REMINDER_MESSAGE_MAX,
  buildTrackerPeople,
  remindablePeople,
  trackerCounts,
  type TrackerCounts,
  type TrackerPerson,
} from "~/forms/lib/form-tracker";

const FORM_SELECT = {
  id: true,
  name: true,
  published: true,
  publicToken: true,
  closesAt: true,
  lastRemindedAt: true,
  audience: true,
  audienceGroupIds: true,
} as const;

type TrackerForm = {
  id: string;
  name: string;
  published: boolean;
  publicToken: string | null;
  closesAt: Date | null;
  lastRemindedAt: Date | null;
};

type Tracked = { form: TrackerForm; people: TrackerPerson[] };

/** Everyone expected to respond, from the form's groups and its to-do
 *  announcements and banners, across all versions. Null when nobody is expected or the
 *  form belongs to another feature. */
export async function computeFormTracker(formId: string): Promise<Tracked | null> {
  const form = await prisma.form.findUnique({ where: { id: formId }, select: FORM_SELECT });
  if (!form) return null;
  if (managingUsage(await formUsages(formId))) return null;

  const groupIds = form.audience === "Groups" ? form.audienceGroupIds : [];
  const [groupRows, todos, bannerImpressions] = await Promise.all([
    groupIds.length
      ? prisma.groupDefinition.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.notification.findMany({
      where: { formId, isTodo: true },
      select: { recipientUserId: true, readAt: true },
    }),
    prisma.bannerImpression.findMany({
      where: { views: { gt: 0 }, banner: { untilFormId: formId, published: true } },
      select: { userId: true },
    }),
  ]);
  const bannerViewerIds = bannerImpressions.map((i) => i.userId);
  const groups = await Promise.all(
    groupRows.map(async (g) => ({ name: g.name, memberIds: await resolveGroupMembers(g.id) })),
  );
  const todoRows = todos.map((t) => ({ userId: t.recipientUserId, readAt: t.readAt }));

  const expectedIds = new Set([
    ...groups.flatMap((g) => g.memberIds),
    ...todoRows.map((t) => t.userId),
    ...bannerViewerIds,
  ]);
  if (expectedIds.size === 0) return null;

  const submissions = await prisma.formSubmission.findMany({
    where: { formId, userId: { in: [...expectedIds] } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const people = buildTrackerPeople({
    groups,
    todos: todoRows,
    bannerViewerIds,
    respondedIds: new Set(submissions.flatMap((s) => (s.userId ? [s.userId] : []))),
  });
  return { form, people };
}

export async function loadTrackerCounts(formId: string): Promise<TrackerCounts | null> {
  const tracked = await computeFormTracker(formId);
  return tracked ? trackerCounts(tracked.people) : null;
}

export type TrackerListPerson = {
  userId: string;
  name: string;
  photoUrl: string | null;
  sources: string[];
  dismissed: boolean;
};

export type TrackerList = {
  formName: string;
  published: boolean;
  closesAt: string | null;
  lastRemindedAt: string | null;
  expected: number;
  notResponded: TrackerListPerson[];
};

/** The names behind the count: people who haven't responded, dismissed last. */
export async function loadTrackerList(formId: string): Promise<TrackerList | null> {
  const tracked = await computeFormTracker(formId);
  if (!tracked) return null;
  const pending = tracked.people.filter((p) => !p.responded);
  const users = await prisma.user.findMany({
    where: { id: { in: pending.map((p) => p.userId) } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const rows = await Promise.all(
    pending.map(async (p) => {
      const u = byId.get(p.userId);
      return {
        userId: p.userId,
        name: (u && fullName(u)) || "Unknown member",
        photoUrl: u ? await resolvePhotoUrl(u.photoUrl) : null,
        sources: p.sources,
        dismissed: p.dismissed,
      };
    }),
  );
  rows.sort((a, b) => Number(a.dismissed) - Number(b.dismissed) || a.name.localeCompare(b.name));
  return {
    formName: tracked.form.name,
    published: tracked.form.published,
    closesAt: tracked.form.closesAt?.toISOString() ?? null,
    lastRemindedAt: tracked.form.lastRemindedAt?.toISOString() ?? null,
    expected: tracked.people.length,
    notResponded: rows,
  };
}

async function deliverReminder(args: {
  form: TrackerForm;
  userIds: string[];
  message: string;
  dedupKey: string;
  actorId: string | null;
}): Promise<void> {
  await notify({
    eventType: "form.reminder",
    createdByUserId: args.actorId,
    message: {
      title: `Reminder: ${args.form.name}`,
      body: args.message,
      vars: { itemTitle: args.form.name },
      link: `/forms/fill/${args.form.publicToken}`,
      isTodo: false,
      formId: args.form.id,
      dedupKey: args.dedupKey,
    },
    recipients: args.userIds.map((userId) => ({ userId })),
  });
}

type Failure = { error: string; status: number };

/** Manual reminder from the tracker modal. Recipients, publish state and the
 *  24 hour limit are all decided here, never taken from the request. */
export async function sendFormReminder(args: {
  formId: string;
  actorId: string;
  message: string;
  request?: Request;
  now?: Date;
}): Promise<{ ok: true; sent: number } | Failure> {
  const now = args.now ?? new Date();
  const message = args.message.trim();
  if (!message) return { error: "Write a message to send.", status: 400 };
  if (message.length > REMINDER_MESSAGE_MAX) {
    return { error: `Keep the message under ${REMINDER_MESSAGE_MAX} characters.`, status: 400 };
  }

  const tracked = await computeFormTracker(args.formId);
  if (!tracked) return { error: "Nobody is expected to respond to this form.", status: 400 };
  const { form } = tracked;
  if (!form.published || !form.publicToken) {
    return { error: "This form isn't published, so a reminder would link to nothing.", status: 409 };
  }
  const recipients = remindablePeople(tracked.people);
  if (recipients.length === 0) {
    return { error: "Everyone left dismissed the to-do, so there's nobody to remind.", status: 409 };
  }

  const cutoff = new Date(now.getTime() - REMINDER_COOLDOWN_MS);
  const claimed = await prisma.form.updateMany({
    where: {
      id: form.id,
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: cutoff } }],
    },
    data: { lastRemindedAt: now },
  });
  if (claimed.count !== 1) {
    return { error: "A reminder went out in the last 24 hours. Try again later.", status: 429 };
  }

  try {
    await deliverReminder({
      form,
      userIds: recipients.map((p) => p.userId),
      message,
      dedupKey: `form.reminder:${form.id}:${now.toISOString()}`,
      actorId: args.actorId,
    });
  } catch (err) {
    await prisma.form.updateMany({
      where: { id: form.id, lastRemindedAt: now },
      data: { lastRemindedAt: form.lastRemindedAt },
    });
    throw err;
  }

  await logAuditEvent({
    action: "form.reminder.send",
    userId: args.actorId,
    targetId: form.id,
    metadata: { recipientCount: recipients.length },
    request: args.request,
  });
  return { ok: true, sent: recipients.length };
}

/** The automatic reminder before a form closes. Idempotent per close time. */
export async function sendCloseReminder(args: {
  formId: string;
  message: (form: TrackerForm) => string;
}): Promise<number> {
  const tracked = await computeFormTracker(args.formId);
  if (!tracked) return 0;
  const { form } = tracked;
  if (!form.published || !form.publicToken || !form.closesAt) return 0;
  const recipients = remindablePeople(tracked.people);
  if (recipients.length === 0) return 0;
  await deliverReminder({
    form,
    userIds: recipients.map((p) => p.userId),
    message: args.message(form),
    dedupKey: `form.reminder:${form.id}:close:${form.closesAt.toISOString()}`,
    actorId: null,
  });
  return recipients.length;
}
