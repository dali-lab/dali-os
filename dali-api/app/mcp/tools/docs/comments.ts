// MCP `list_comments` — fetch comment threads for a document, file, or page-doc.
// Permission mirrors api.comments.ts GET.

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { hydrateAuthors } from "~/lib/collabAuth";

export const LIST_COMMENTS_TOOL = {
  name: "list_comments",
  description:
    "List comment threads on a document (Page), project file, or page-doc FAQ. Returns root comments and their replies in creation order. Permissions: docs require view access; files require Core or project membership; page-docs require lab membership.",
  inputSchema: {
    type: "object" as const,
    properties: {
      targetType: {
        type: "string",
        enum: ["doc", "file", "pagedoc"],
        description:
          "The kind of target: 'doc' (Page), 'file' (ProjectFile), or 'pagedoc' (page-doc FAQ).",
      },
      targetId: { type: "string", minLength: 1, description: "ID of the target." },
    },
    required: ["targetType", "targetId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type CommentTarget = "doc" | "file" | "pagedoc";

type Input = { targetType: CommentTarget; targetId: string };

export class ListCommentsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ListCommentsError";
  }
}

async function canRead(
  callerId: string,
  targetType: CommentTarget,
  targetId: string,
): Promise<boolean> {
  if (targetType === "pagedoc") return isLabMember(callerId);
  if (targetType === "doc") {
    const access = await getPageAccess(callerId, targetId);
    return access.canComment;
  }
  if (await isCore(callerId)) return true;
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { projectId: true },
  });
  return file ? isProjectMember(callerId, file.projectId) : false;
}

export async function runListComments(callerId: string, input: Input) {
  if (!(await canRead(callerId, input.targetType, input.targetId))) {
    throw new ListCommentsError("Forbidden", 403);
  }

  const rows = await prisma.docComment.findMany({
    where: { targetType: input.targetType, targetId: input.targetId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      authorId: true,
      body: true,
      anchor: true,
      resolvedAt: true,
      createdAt: true,
      versionId: true,
      updatedAt: true,
      reactions: {
        select: { userId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const authors = await hydrateAuthors([...new Set(rows.map((r) => r.authorId))]);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));
  const photoById = new Map(authors.map((a) => [a.id, a.photoUrl]));

  const comments = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    author: nameById.get(r.authorId) ?? "Unknown",
    authorId: r.authorId,
    authorPhotoUrl: photoById.get(r.authorId) ?? null,
    body: r.body,
    anchor: r.anchor as { from: string; to: string } | null,
    resolved: r.resolvedAt !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    versionId: r.versionId,
    reactions: r.reactions,
  }));

  return { comments };
}
