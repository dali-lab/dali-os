import type { Route } from "./+types/api.comments";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { hydrateAuthors } from "~/lib/collabAuth";
import { resolveMentions } from "~/lib/mentions";
import { loadProjectRoster, loadLabRoster } from "~/lib/mentions.server";

// Comments + inline annotations on documents (Pages) and files (ProjectFile).
//   GET  /api/comments?targetType=doc|file&targetId=...   → threads (roots + replies)
//   POST /api/comments  { targetType, targetId, body, parentId?, anchor? }
//
// `anchor` (doc only) carries a Yjs relative-position range so an inline
// comment survives collaborative edits; null = a doc/file-level comment.
// Read + write mirror the project-edit gate (isCore === Admin || Core), the
// same surface that can open the doc/file.

const AnchorSchema = z
  .object({ from: z.string(), to: z.string() })
  .nullable()
  .optional();

const CreateSchema = z.object({
  targetType: z.enum(["doc", "file"]),
  targetId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  parentId: z.string().optional(),
  anchor: AnchorSchema,
});

// Confirm the target exists and is live, matching authorizeCollabDoc's doc gate.
async function targetExists(targetType: "doc" | "file", targetId: string): Promise<boolean> {
  if (targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: targetId },
      select: { workspaceType: true, archivedAt: true },
    });
    return !!page && page.workspaceType === "Project" && page.archivedAt === null;
  }
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { archivedAt: true },
  });
  return !!file && file.archivedAt === null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  if ((targetType !== "doc" && targetType !== "file") || !targetId) {
    return withCors(request, Response.json({ error: "Invalid target" }, { status: 400 }));
  }

  const rows = await prisma.docComment.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      authorId: true,
      body: true,
      anchor: true,
      resolvedAt: true,
      createdAt: true,
    },
  });

  const authors = await hydrateAuthors([...new Set(rows.map((r) => r.authorId))]);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));

  const comments = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    author: nameById.get(r.authorId) ?? "Unknown",
    authorId: r.authorId,
    body: r.body,
    anchor: r.anchor as { from: string; to: string } | null,
    resolved: r.resolvedAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));

  return withCors(request, Response.json({ comments }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return withCors(request, body);

  if (!(await targetExists(body.targetType, body.targetId))) {
    return withCors(request, Response.json({ error: "Target not found" }, { status: 404 }));
  }
  // Replies must point at an existing root comment on the same target. Only one
  // level of threading: reject replying to a reply.
  if (body.parentId) {
    const parent = await prisma.docComment.findUnique({
      where: { id: body.parentId },
      select: { targetType: true, targetId: true, parentId: true },
    });
    if (
      !parent ||
      parent.targetType !== body.targetType ||
      parent.targetId !== body.targetId ||
      parent.parentId !== null
    ) {
      return withCors(request, Response.json({ error: "Invalid parent comment" }, { status: 400 }));
    }
  }
  // Anchors only make sense on documents.
  const anchor = body.targetType === "doc" ? (body.anchor ?? null) : null;

  const created = await prisma.docComment.create({
    data: {
      targetType: body.targetType,
      targetId: body.targetId,
      parentId: body.parentId ?? null,
      authorId: auth.user.sub,
      body: body.body,
      anchor: anchor === null ? undefined : anchor,
      // Real FK only on the file side (see schema note).
      fileId: body.targetType === "file" ? body.targetId : null,
    },
    select: { id: true },
  });

  // Best-effort: notify @-mentioned users. Roster = the comment target's
  // owning project (or the whole lab if the page lives in the Lab workspace).
  try {
    await notifyMentions({
      authorId: auth.user.sub,
      commentBody: body.body,
      targetType: body.targetType,
      targetId: body.targetId,
    });
  } catch (err) {
    console.error("[api.comments] mention notify failed:", err);
  }

  return withCors(request, Response.json({ id: created.id }, { status: 201 }));
}

async function notifyMentions(input: {
  authorId: string;
  commentBody: string;
  targetType: "doc" | "file";
  targetId: string;
}) {
  let roster = await loadRosterForTarget(input.targetType, input.targetId);
  if (roster.length === 0) roster = await loadLabRoster();
  const mentions = resolveMentions(input.commentBody, roster);
  if (mentions.length === 0) return;

  const recipients = mentions
    .map((m) => m.userId)
    .filter((id) => id !== input.authorId);
  if (recipients.length === 0) return;

  const author = await prisma.user.findUnique({
    where: { id: input.authorId },
    select: { firstName: true, lastName: true },
  });
  const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "Someone";
  const link =
    input.targetType === "doc"
      ? `/documents/${input.targetId}`
      : `/documents/file/${input.targetId}`;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      recipientUserId: userId,
      createdByUserId: input.authorId,
      kind: "General" as const,
      title: `${authorName} mentioned you in a comment`,
      body: input.commentBody.slice(0, 280),
      link,
    })),
  });
}

async function loadRosterForTarget(targetType: "doc" | "file", targetId: string) {
  if (targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: targetId },
      select: { workspaceType: true, workspaceId: true },
    });
    if (page?.workspaceType === "Project" && page.workspaceId) {
      return loadProjectRoster(page.workspaceId);
    }
    return [];
  }
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { projectId: true },
  });
  if (file?.projectId) return loadProjectRoster(file.projectId);
  return [];
}
