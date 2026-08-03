import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { logAuditEvent } from "~/lib/audit";
import { educationLink } from "./notifications.server";

// Course discussion board: top-level posts + one reply level, plain text.
// Notification policy (in-app only):
//   - student top-level post → instructors
//   - instructor top-level post → every Approved enrollee
//   - reply → the parent post's author
// The author never notifies themself.

export async function listThreads(offeringId: string, instructorIds: Set<string>) {
  const posts = await prisma.educationDiscussionPost.findMany({
    where: { offeringId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      parentId: true,
      createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const roots = posts.filter((p) => p.parentId === null);
  const repliesByParent = new Map<string, typeof posts>();
  for (const p of posts) {
    if (!p.parentId) continue;
    const list = repliesByParent.get(p.parentId) ?? [];
    list.push(p);
    repliesByParent.set(p.parentId, list);
  }
  const shape = (p: (typeof posts)[number]) => ({
    id: p.id,
    body: p.body,
    createdAt: p.createdAt,
    authorId: p.author.id,
    authorName: `${p.author.firstName} ${p.author.lastName}`.trim(),
    isInstructor: instructorIds.has(p.author.id),
  });
  // Newest threads first; replies oldest-first beneath their root.
  return roots
    .slice()
    .reverse()
    .map((root) => ({
      ...shape(root),
      replies: (repliesByParent.get(root.id) ?? []).map(shape),
    }));
}

export async function offeringInstructorIds(offeringId: string): Promise<Set<string>> {
  const rows = await prisma.instructorAssignment.findMany({
    where: { offeringId },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

type PostResult = { ok: true; id: string } | { error: string; status: number };

export async function createPost(args: {
  offeringId: string;
  authorId: string;
  body: string;
  parentId?: string | null;
}): Promise<PostResult> {
  const body = args.body.trim();
  if (!body) return { error: "Post text is required", status: 400 };

  if (args.parentId) {
    const parent = await prisma.educationDiscussionPost.findUnique({
      where: { id: args.parentId },
      select: { offeringId: true, parentId: true },
    });
    if (!parent || parent.offeringId !== args.offeringId)
      return { error: "Thread not found", status: 404 };
    // One reply level: replying to a reply is rejected here so the data
    // shape stays predictable.
    if (parent.parentId !== null)
      return { error: "Replies can't be nested further", status: 400 };
  }

  const post = await prisma.educationDiscussionPost.create({
    data: {
      offeringId: args.offeringId,
      authorId: args.authorId,
      body,
      parentId: args.parentId ?? null,
    },
    select: { id: true },
  });

  await notifyDiscussionPost({
    offeringId: args.offeringId,
    authorId: args.authorId,
    parentId: args.parentId ?? null,
    body,
  }).catch((err) => {
    console.error("education discussion notify failed", {
      offeringId: args.offeringId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await logAuditEvent({
    action: "education.discussion.post",
    userId: args.authorId,
    targetId: post.id,
    metadata: { offeringId: args.offeringId, reply: args.parentId != null },
  });
  return { ok: true, id: post.id };
}

/** Author deletes their own post; managers may delete any (route-gated). */
export async function deletePost(args: {
  postId: string;
  offeringId: string;
  actorId: string;
  isManager: boolean;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const post = await prisma.educationDiscussionPost.findUnique({
    where: { id: args.postId },
    select: { offeringId: true, authorId: true },
  });
  if (!post || post.offeringId !== args.offeringId)
    return { error: "Post not found", status: 404 };
  if (post.authorId !== args.actorId && !args.isManager)
    return { error: "Forbidden", status: 403 };
  // Replies cascade via the parent FK.
  await prisma.educationDiscussionPost.delete({ where: { id: args.postId } });
  await logAuditEvent({
    action: "education.discussion.delete",
    userId: args.actorId,
    targetId: args.postId,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true };
}

/** FormData dispatcher shared by the member and portal hub route actions. */
export async function runDiscussionAction(
  formData: FormData,
  ctx: { offeringId: string; userId: string; isManager: boolean },
): Promise<Response | { ok: true }> {
  const intent = formData.get("intent");
  // The offering-wide discussion (announcements + messages + replies). Distinct
  // from the assignment threads below, which hang off a single assignment.
  // postAnnouncement re-checks membership itself, so a student can't broadcast
  // by posting kind=Announcement from the hub.
  if (intent === "post-announcement") {
    const { postAnnouncement } = await import("./announcements.server");
    const result = await postAnnouncement({
      offeringId: ctx.offeringId,
      authorId: ctx.userId,
      body: String(formData.get("body") ?? ""),
      kind: formData.get("kind") === "Announcement" ? "Announcement" : "Message",
      parentId: String(formData.get("parentId") ?? "") || null,
    });
    if ("error" in result)
      return Response.json({ error: result.error }, { status: result.status });
    return { ok: true };
  }
  if (intent === "post-discussion") {
    const result = await createPost({
      offeringId: ctx.offeringId,
      authorId: ctx.userId,
      body: String(formData.get("body") ?? ""),
      parentId: String(formData.get("parentId") ?? "") || null,
    });
    if ("error" in result)
      return Response.json({ error: result.error }, { status: result.status });
    return { ok: true };
  }
  if (intent === "delete-discussion") {
    const result = await deletePost({
      postId: String(formData.get("postId") ?? ""),
      offeringId: ctx.offeringId,
      actorId: ctx.userId,
      isManager: ctx.isManager,
    });
    if ("error" in result)
      return Response.json({ error: result.error }, { status: result.status });
    return { ok: true };
  }
  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

async function notifyDiscussionPost(args: {
  offeringId: string;
  authorId: string;
  parentId: string | null;
  body: string;
}): Promise<void> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true, title: true },
  });
  if (!offering) return;

  let recipientIds: string[];
  if (args.parentId) {
    const parent = await prisma.educationDiscussionPost.findUnique({
      where: { id: args.parentId },
      select: { authorId: true },
    });
    recipientIds = parent ? [parent.authorId] : [];
  } else {
    const instructorIds = await offeringInstructorIds(args.offeringId);
    if (instructorIds.has(args.authorId)) {
      const enrollees = await prisma.educationApplication.findMany({
        where: { offeringId: args.offeringId, status: "Approved" },
        select: { applicantUserId: true },
      });
      recipientIds = enrollees.map((e) => e.applicantUserId);
    } else {
      recipientIds = [...instructorIds];
    }
  }
  const recipients = recipientIds.filter((id) => id !== args.authorId);
  if (recipients.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: recipients } },
    select: { id: true, daliEmail: true },
  });
  const preview = args.body.length > 140 ? `${args.body.slice(0, 140)}…` : args.body;
  await notify({
    eventType: "education.discussion",
    createdByUserId: args.authorId,
    message: {
      title: args.parentId
        ? `New reply in ${offering.title}`
        : `New discussion post in ${offering.title}`,
      body: preview,
    },
    recipients: users.map((u) => ({
      userId: u.id,
      link: `${educationLink(u, offering.id)}/hub?tab=discussions`,
    })),
  });
}
