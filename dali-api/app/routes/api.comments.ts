import type { Route } from "./+types/api.comments";
import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { requireAuth, forbidden, type AuthSuccess } from "~/lib/auth";
import { isLabMember, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { hydrateAuthors } from "~/lib/collabAuth";
import { withEmojiImages } from "~/lib/reactions.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { createDocComment, CommentCreateError, type CommentTarget } from "~/lib/doc-comments.server";
import type { BodySegment } from "~/lib/comment-body";
import { commentAnchorSchema } from "~/lib/slide-comments";

// Comments + inline annotations on documents (Pages) and files (ProjectFile).
//   GET  /api/comments?targetType=doc|file|pagedoc&targetId=...   → threads (roots + replies)
//   POST /api/comments  { targetType, targetId, body, parentId?, anchor? }
//
// `anchor` (doc only) carries a Yjs relative-position range so an inline
// comment survives collaborative edits; null = a doc/file-level comment.
//
// A comment has no open/resolved state — every thread on a target is returned,
// in creation order, and the surfaces render them as one list.
//
// Permission matrix:
//   doc target   — read/create/reply: canView (any member, partner-visible partner)
//   file target  — read/create/reply: Core or project member of owning project
//   pagedoc      — read/create/reply: any lab member (open FAQ threads)

const AnchorSchema = commentAnchorSchema;

// bodyJson segment schema — mirrors the BodySegment union from MentionTextInput.
// We accept the raw JSON from the client and store it as-is; validation here
// is permissive (array of objects) to avoid version skew issues.
const BodySegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({
    type: z.literal("mention"),
    userId: z.string().min(1).max(256),
    label: z.string().max(256),
  }),
]);

const CreateSchema = z.object({
  targetType: z.enum(["doc", "file", "pagedoc"]),
  targetId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  /** Rich inline segments. When present, stored in DocComment.bodyJson and used
   * for mention notifications (userId-based, exact; supplement the handle-based
   * path which still runs for backward-compat). */
  bodyJson: z.array(BodySegmentSchema).max(500).nullable().optional(),
  parentId: z.string().nullable().optional(),
  anchor: AnchorSchema,
  // Page-doc FAQ comments only: the page path, so @-mention notifications can
  // deep-link back to the guide (with ?doc=1).
  path: z.string().max(1000).optional(),
  // File comments only: the version the commenter was viewing, so feedback
  // is pinned to the iteration it was written against.
  versionId: z.string().min(1).nullable().optional(),
});

// Auth split by target type:
//   pagedoc — any lab member (open FAQ)
//   doc     — canView per getPageAccess (any member, or partner on partner-visible page)
//   file    — Core or project member of the owning project
async function canReadTarget(
  auth: AuthSuccess,
  targetType: CommentTarget,
  targetId: string,
  request?: Request,
): Promise<boolean> {
  if (targetType === "pagedoc") return isLabMember(auth.user.sub, request);
  if (targetType === "doc") {
    const access = await getPageAccess(auth.user.sub, targetId, request);
    return access.canComment;
  }
  // file: Core or project member
  const { isCore } = await import("~/lib/roles");
  if (await isCore(auth.user.sub, request)) return true;
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { projectId: true },
  });
  if (!file || !file.projectId) return false;
  return isProjectMember(auth.user.sub, file.projectId);
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  if (
    (targetType !== "doc" && targetType !== "file" && targetType !== "pagedoc") ||
    !targetId
  ) {
    return withCors(request, Response.json({ error: "Invalid target" }, { status: 400 }));
  }
  // The access walk and the comment read are independent; the rows are only
  // returned once access is confirmed.
  const [allowed, rows] = await Promise.all([
    canReadTarget(auth, targetType, targetId, request),
    prisma.docComment.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        parentId: true,
        authorId: true,
        body: true,
        bodyJson: true,
        anchor: true,
        createdAt: true,
        versionId: true,
        updatedAt: true,
        reactions: {
          select: { userId: true, emoji: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);
  if (!allowed) return forbidden(request);

  const authors = await hydrateAuthors([
    ...new Set(rows.flatMap((r) => [r.authorId, ...r.reactions.map((x) => x.userId)])),
  ]);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));
  const photoById = new Map(authors.map((a) => [a.id, a.photoUrl]));

  const comments = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    author: nameById.get(r.authorId) ?? "Unknown",
    authorId: r.authorId,
    authorPhotoUrl: photoById.get(r.authorId) ?? null,
    body: r.body,
    bodyJson: r.bodyJson as BodySegment[] | null,
    anchor: r.anchor as Record<string, unknown> | null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    versionId: r.versionId,
    reactions: r.reactions.map((x) => ({ ...x, name: nameById.get(x.userId) ?? "Unknown" })),
  }));

  return withCors(request, Response.json({ comments: await withEmojiImages(comments) }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return withCors(request, body);

  if (!(await canReadTarget(auth, body.targetType, body.targetId, request))) {
    return forbidden(request);
  }

  try {
    const created = await createDocComment({
      targetType: body.targetType,
      targetId: body.targetId,
      parentId: body.parentId,
      authorId: auth.user.sub,
      body: body.body,
      bodyJson: body.bodyJson,
      anchor: body.anchor,
      versionId: body.versionId,
      path: body.path,
    });
    return withCors(request, Response.json({ id: created.id }, { status: 201 }));
  } catch (err) {
    if (err instanceof CommentCreateError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }
}
