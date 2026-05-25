import type { Route } from "./+types/api.comments";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { hydrateAuthors } from "~/lib/collabAuth";

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
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
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
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
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

  return withCors(request, Response.json({ id: created.id }, { status: 201 }));
}
