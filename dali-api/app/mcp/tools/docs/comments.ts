// MCP `list_comments` — fetch comment threads for a document, file, or page-doc.
// Permission mirrors api.comments.ts GET.

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { hydrateAuthors } from "~/lib/collabAuth";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const COMMENT_SELECT = {
  id: true,
  parentId: true,
  authorId: true,
  body: true,
  anchor: true,
  createdAt: true,
  versionId: true,
  updatedAt: true,
  reactions: {
    select: { userId: true, emoji: true, createdAt: true },
    orderBy: { createdAt: "asc" as const },
  },
};

export const LIST_COMMENTS_TOOL = {
  name: "list_comments",
  description:
    "List comment threads on a document (Page), project file, or page-doc FAQ. Pages by root comment, oldest first, and each root is followed by all of its replies. limit counts root comments. Pass page.nextCursor as cursor to read the next page until page.hasMore is false. Permissions: docs require view access; files require Core or project membership; page-docs require lab membership.",
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
      ...pageProps(PAGE_LIMITS),
    },
    required: ["targetType", "targetId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type CommentTarget = "doc" | "file" | "pagedoc";

type Input = PageArgs & { targetType: CommentTarget; targetId: string };

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
  if (!file || !file.projectId) return false;
  return isProjectMember(callerId, file.projectId);
}

export async function runListComments(callerId: string, input: Input) {
  if (!(await canRead(callerId, input.targetType, input.targetId))) {
    throw new ListCommentsError("Forbidden", 403);
  }

  const rootWhere = { targetType: input.targetType, targetId: input.targetId, parentId: null };
  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "createdAt", direction: "asc", type: "date" }], "asc");
  const [fetchedRoots, total] = await Promise.all([
    prisma.docComment.findMany({
      where: { AND: [rootWhere, window.where] },
      orderBy: window.orderBy,
      take: window.take,
      select: COMMENT_SELECT,
    }),
    prisma.docComment.count({ where: rootWhere }),
  ]);
  const { rows: roots, page } = keysetPage(fetchedRoots, window, total);
  const replies = roots.length
    ? await prisma.docComment.findMany({
        where: { parentId: { in: roots.map((r) => r.id) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: COMMENT_SELECT,
      })
    : [];
  const repliesByRoot = new Map<string, typeof replies>();
  for (const reply of replies) {
    const siblings = repliesByRoot.get(reply.parentId as string) ?? [];
    siblings.push(reply);
    repliesByRoot.set(reply.parentId as string, siblings);
  }
  const rows = roots.flatMap((root) => [root, ...(repliesByRoot.get(root.id) ?? [])]);

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
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    versionId: r.versionId,
    reactions: r.reactions,
  }));

  return { page, comments };
}
