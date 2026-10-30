import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { fullName } from "~/lib/display";
import { logAuditEvent } from "~/lib/audit";
import type { NotificationCopyKey } from "~/email/lib/notification-copy";
import {
  ListservAttachmentSchema,
  ListservBlockSchema,
  canTake,
  formatDay,
  hasContent,
  labToday,
  type ListservAction,
  type ListservAttachment,
  type ListservBlock,
  type ListservDraft,
  type ListservStatus,
} from "~/core/lib/listserv";

export const LISTSERV_PATH = "/core/communications/listserv";
export const LISTSERV_UPLOAD_PREFIX = "uploads/listserv/";

const CONFIG_ID = "default";

export async function getListservConfig() {
  const row = await prisma.listservConfig.findUnique({ where: { id: CONFIG_ID } });
  return { leadUserId: row?.leadUserId ?? null, fromAddress: row?.fromAddress ?? "dali@dartmouth.edu" };
}

export async function setListservConfig(
  patch: { leadUserId?: string | null; fromAddress?: string },
  actorId: string,
  request: Request,
) {
  await prisma.listservConfig.upsert({
    where: { id: CONFIG_ID },
    update: patch,
    create: { id: CONFIG_ID, ...patch },
  });
  await logAuditEvent({
    action: "listserv.config",
    userId: actorId,
    targetId: CONFIG_ID,
    metadata: patch,
    request,
  });
}

/** The outreach lead reviews and sends. Admins can always stand in. */
export function isListservLead(
  userId: string,
  config: { leadUserId: string | null },
  viewerIsAdmin: boolean,
): boolean {
  return viewerIsAdmin || (config.leadUserId !== null && config.leadUserId === userId);
}

function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dateToDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Uploaded media must come from the listserv's own upload prefix. */
function isOwnUpload(key: string): boolean {
  return key.startsWith(LISTSERV_UPLOAD_PREFIX) && !key.includes("..");
}

function isAllowedImageUrl(url: string): boolean {
  if (/^https:\/\//.test(url)) return true;
  const m = /^\/api\/upload\/raw\?key=(.+)$/.exec(url);
  return !!m && isOwnUpload(decodeURIComponent(m[1]!));
}

export type DraftProblem = { field: "subject" | "content" | "attachments" | "sendBy"; message: string };

/** Server-side checks on a submitter's draft beyond its shape. */
export function checkDraft(draft: ListservDraft, today: string): DraftProblem | null {
  if (!hasContent(draft.content)) return { field: "content", message: "Write the email or add an image" };
  for (const b of draft.content) {
    if (b.type === "image" && !isAllowedImageUrl(b.url)) {
      return { field: "content", message: "That image link isn't allowed" };
    }
  }
  if (draft.attachments.some((a) => !isOwnUpload(a.key))) {
    return { field: "attachments", message: "Attach files by uploading them" };
  }
  if (draft.sendBy && draft.sendBy < today) {
    return { field: "sendBy", message: "Pick today or a later day" };
  }
  return null;
}

export type ListservRow = {
  id: string;
  status: ListservStatus;
  subject: string;
  content: ListservBlock[];
  attachments: (ListservAttachment & { url: string })[];
  sendBy: string | null;
  sentOn: string | null;
  note: string | null;
  feedback: string | null;
  submittedAt: string;
  submitter: { id: string; name: string };
};

function parseBlocks(raw: unknown): ListservBlock[] {
  const parsed = ListservBlockSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function parseAttachments(raw: unknown): ListservAttachment[] {
  const parsed = ListservAttachmentSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

const SENT_HISTORY_DAYS = 120;

export async function listListserv(now: Date = new Date()): Promise<ListservRow[]> {
  const since = new Date(now.getTime() - SENT_HISTORY_DAYS * 86_400_000);
  const rows = await prisma.listservSubmission.findMany({
    where: { OR: [{ status: { not: "Sent" } }, { sentOn: { gte: since } }] },
    orderBy: { submittedAt: "asc" },
  });
  const people = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.submittedById))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(people.map((p) => [p.id, fullName(p) || "Unknown"]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    subject: r.subject,
    content: parseBlocks(r.content),
    attachments: parseAttachments(r.attachments).map((a) => ({
      ...a,
      url: `/api/upload/raw?key=${encodeURIComponent(a.key)}`,
    })),
    sendBy: dateToDay(r.sendBy),
    sentOn: dateToDay(r.sentOn),
    note: r.note,
    feedback: r.feedback,
    submittedAt: r.submittedAt.toISOString(),
    submitter: { id: r.submittedById, name: nameById.get(r.submittedById) ?? "Unknown" },
  }));
}

async function notifyListserv(
  copyKey: NotificationCopyKey,
  recipientIds: (string | null)[],
  actorId: string,
  vars: Record<string, string>,
) {
  const recipients = [...new Set(recipientIds.filter((id): id is string => !!id && id !== actorId))];
  if (recipients.length === 0) return;
  try {
    await notify({
      eventType: "listserv",
      createdByUserId: actorId,
      message: { copyKey, vars, link: LISTSERV_PATH },
      recipients: recipients.map((userId) => ({ userId })),
    });
  } catch (err) {
    console.error(`[listserv] ${copyKey} notify failed`, err);
  }
}

async function actorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  return (u && fullName(u)) || "A Core member";
}

function draftData(draft: ListservDraft) {
  return {
    subject: draft.subject.trim(),
    content: draft.content,
    attachments: draft.attachments,
    sendBy: draft.sendBy ? dayToDate(draft.sendBy) : null,
    note: draft.note.trim() || null,
  };
}

export async function submitListserv(draft: ListservDraft, actorId: string) {
  const row = await prisma.listservSubmission.create({
    data: { ...draftData(draft), submittedById: actorId },
    select: { id: true },
  });
  const config = await getListservConfig();
  await notifyListserv("listserv.submitted", [config.leadUserId], actorId, {
    itemTitle: draft.subject.trim(),
    personName: await actorName(actorId),
  });
  return row.id;
}

export type ActResult = { ok: true } | { ok: false; error: string };

/**
 * Moves one submission through its review. Every write is guarded on the
 * status it started from, so two people acting at once can't both win.
 */
export async function actOnListserv(args: {
  id: string;
  action: Exclude<ListservAction, "mark-sent">;
  actorId: string;
  isLead: boolean;
  draft?: ListservDraft;
  feedback?: string;
}): Promise<ActResult> {
  const row = await prisma.listservSubmission.findUnique({
    where: { id: args.id },
    select: { status: true, submittedById: true, subject: true },
  });
  if (!row) return { ok: false, error: "That submission is gone." };
  const viewer = { isLead: args.isLead, isOwner: row.submittedById === args.actorId };
  if (!canTake(args.action, row.status, viewer)) {
    return { ok: false, error: "That isn't possible for this submission any more." };
  }
  const where = { id: args.id, status: row.status };

  if (args.action === "withdraw") {
    await prisma.listservSubmission.deleteMany({ where });
    return { ok: true };
  }

  if (args.action === "request-changes" && !args.feedback?.trim()) {
    return { ok: false, error: "Say what should change." };
  }

  const data = (() => {
    switch (args.action) {
      case "approve":
        return { status: "Approved" as const, feedback: null, reviewedById: args.actorId };
      case "unapprove":
        return { status: "Submitted" as const };
      case "request-changes":
        return {
          status: "ChangesRequested" as const,
          feedback: args.feedback?.trim() || null,
          reviewedById: args.actorId,
        };
      case "unmark-sent":
        return { status: "Approved" as const, sentOn: null, sentById: null };
      case "edit":
        // Any edit sends it back to review: an approved email that changed has
        // to be looked at again.
        return { ...draftData(args.draft!), status: "Submitted" as const, feedback: null };
      default:
        throw new Error(`unhandled listserv action ${args.action}`);
    }
  })();

  const { count } = await prisma.listservSubmission.updateMany({ where, data });
  if (count === 0) return { ok: false, error: "Someone else changed it first. Reload to see it." };

  const subject = args.action === "edit" ? args.draft!.subject.trim() : row.subject;
  if (args.action === "approve") {
    await notifyListserv("listserv.approved", [row.submittedById], args.actorId, { itemTitle: subject });
  } else if (args.action === "request-changes") {
    await notifyListserv("listserv.changes_requested", [row.submittedById], args.actorId, {
      itemTitle: subject,
      itemDetail: args.feedback!.trim(),
    });
  } else if (args.action === "edit") {
    const config = await getListservConfig();
    await notifyListserv("listserv.submitted", [config.leadUserId], args.actorId, {
      itemTitle: subject,
      personName: await actorName(args.actorId),
    });
  }
  return { ok: true };
}

/** Records that these approved emails went out on `sentOn` (a lab-calendar day). */
export async function markListservSent(
  ids: string[],
  sentOn: string,
  actorId: string,
  now: Date = new Date(),
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: false, error: "Pick at least one email." };
  if (sentOn > labToday(now)) return { ok: false, error: "That day hasn't happened yet." };
  const ready = await prisma.listservSubmission.findMany({
    where: { id: { in: ids }, status: "Approved" },
    select: { id: true, submittedById: true, subject: true },
  });
  if (ready.length === 0) return { ok: false, error: "None of those are ready to send." };
  await prisma.listservSubmission.updateMany({
    where: { id: { in: ready.map((r) => r.id) }, status: "Approved" },
    data: { status: "Sent", sentOn: dayToDate(sentOn), sentById: actorId },
  });
  for (const r of ready) {
    await notifyListserv("listserv.sent", [r.submittedById], actorId, {
      itemTitle: r.subject,
      when: sentOn === labToday(now) ? "today" : `on ${formatDay(sentOn)}`,
    });
  }
  return { ok: true, count: ready.length };
}
