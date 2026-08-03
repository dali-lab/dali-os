import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import { educationLink } from "./notifications.server";
import { isOfferingManager } from "./access.server";

// The offering's discussion. Instructors post an Announcement (fans out to
// every enrollee) or an ordinary Message; approved students post Messages;
// anyone in the offering replies to a top-level post.
//
// The table is still EducationAnnouncement — see the schema comment. Only the
// feature grew.

const REPLY_LIMIT = 200;

/**
 * Top-level posts, newest first, each with its replies oldest-first (a thread
 * reads forwards even though the list reads backwards).
 */
export async function listDiscussion(offeringId: string) {
  const posts = await prisma.educationAnnouncement.findMany({
    where: { offeringId, parentId: null },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      body: true,
      kind: true,
      sentAt: true,
      authorId: true,
      author: { select: { firstName: true, lastName: true } },
      replies: {
        orderBy: { sentAt: "asc" },
        take: REPLY_LIMIT,
        select: {
          id: true,
          body: true,
          sentAt: true,
          authorId: true,
          author: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  return posts;
}

/** True when the user may read and post in this offering's discussion. */
export async function canPostInDiscussion(
  offeringId: string,
  userId: string,
): Promise<{ allowed: boolean; isManager: boolean }> {
  if (await isOfferingManager(userId, offeringId)) return { allowed: true, isManager: true };
  const enrolled = await prisma.educationApplication.findFirst({
    where: { offeringId, applicantUserId: userId, status: "Approved" },
    select: { id: true },
  });
  return { allowed: enrolled !== null, isManager: false };
}

/**
 * Instructor broadcast to every Approved enrollee: announcement row, in-app
 * Notification per recipient, best-effort email per recipient.
 */
export async function postAnnouncement(args: {
  offeringId: string;
  authorId: string;
  body: string;
  /** Announcement is manager-only and fans out; Message is quiet. */
  kind?: "Announcement" | "Message";
  /** Set to reply to a top-level post. */
  parentId?: string | null;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const body = args.body.trim();
  if (!body) return { error: "Write something first", status: 400 };

  const gate = await canPostInDiscussion(args.offeringId, args.authorId);
  if (!gate.allowed) return { error: "Forbidden", status: 403 };

  // A student's post is always a Message: broadcasting to the whole offering
  // is an instructor's call, not something anyone enrolled can trigger.
  const kind = gate.isManager && args.kind !== "Message" ? "Announcement" : "Message";

  // Replies never fan out, and only attach to a top-level post of this
  // offering — one level deep, so a thread stays a conversation.
  let parentId: string | null = null;
  if (args.parentId) {
    const parent = await prisma.educationAnnouncement.findUnique({
      where: { id: args.parentId },
      select: { offeringId: true, parentId: true },
    });
    if (!parent || parent.offeringId !== args.offeringId)
      return { error: "Post not found", status: 404 };
    parentId = parent.parentId ?? args.parentId;
  }

  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true, title: true },
  });
  if (!offering) return { error: "Offering not found", status: 404 };

  const enrollees = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Approved" },
    select: {
      applicant: { select: { id: true, daliEmail: true } },
    },
  });

  await prisma.educationAnnouncement.create({
    data: {
      offeringId: args.offeringId,
      authorId: args.authorId,
      body,
      kind: parentId ? "Message" : kind,
      parentId,
    },
  });

  // Only an announcement interrupts everyone. Messages and replies live in the
  // tab — a discussion that emails the whole offering on every reply stops
  // being one.
  if (parentId || kind === "Message") {
    await logAuditEvent({
      action: "education.announcement.create",
      userId: args.authorId,
      targetId: args.offeringId,
      metadata: { kind: parentId ? "Reply" : "Message" },
    });
    return { ok: true };
  }

  const title = `Announcement — ${offering.title}`;
  const recipients = enrollees
    .map((e) => e.applicant)
    .filter((u) => u.id !== args.authorId);

  if (recipients.length > 0) {
    // notify() covers both surfaces: in-app rows for everyone, and email per
    // preference — education.announcement defaults to Instant, matching the
    // old email-everyone behavior (portal students reach the same address via
    // the netId fallback in the dispatcher's email chain).
    try {
      await notify({
        eventType: "education.announcement",
        createdByUserId: args.authorId,
        message: { title, body },
        recipients: recipients.map((u) => ({
          userId: u.id,
          link: `${educationLink(u, offering.id)}/hub`,
        })),
      });
    } catch (err) {
      console.error("education announcement notifications failed", {
        offeringId: args.offeringId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logAuditEvent({
    action: "education.announcement.create",
    userId: args.authorId,
    targetId: args.offeringId,
    metadata: { recipients: recipients.length },
  });
  return { ok: true };
}
