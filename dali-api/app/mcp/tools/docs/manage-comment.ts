// MCP `manage_comment` — faceted tool for comment CRUD + reactions.
// Actions: create · edit · resolve · reopen · react · unreact · delete.

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { publishCommentChange } from "~/lib/comment-events.server";
import { requireForAction } from "~/mcp/registry";
import type { McpCtx, McpTool } from "~/mcp/registry";

export const MANAGE_COMMENT_TOOL_DEF = {
  name: "manage_comment",
  description:
    "Create, edit, resolve, reopen, react, unreact, or delete a comment on a document (Page), project file, or page-doc. Permissions mirror the web: creating/reacting requires comment access; editing is author-only; resolve/reopen requires edit-level or Core; deleting a file comment requires Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "edit", "resolve", "reopen", "react", "unreact", "delete"],
      },
      // For create
      targetType: {
        type: "string",
        enum: ["doc", "file", "pagedoc"],
        description: "Required for 'create'.",
      },
      targetId: { type: "string", description: "Required for 'create'." },
      body: { type: "string", maxLength: 5000, description: "Required for 'create' and 'edit'." },
      parentId: { type: "string", description: "For 'create': reply to an existing comment." },
      anchor: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        description: "For 'create' on doc targets: Yjs anchor range.",
      },
      versionId: { type: "string", description: "For 'create' on file targets: pin to a file version." },
      // For edit/resolve/reopen/react/unreact/delete
      commentId: { type: "string", description: "Required for all actions except 'create'." },
      emoji: { type: "string", maxLength: 64, description: "Required for 'react'/'unreact'." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CommentTarget = "doc" | "file" | "pagedoc";

export class ManageCommentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ManageCommentError";
  }
}

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["targetType", "targetId", "body"],
  edit: ["commentId", "body"],
  resolve: ["commentId"],
  reopen: ["commentId"],
  react: ["commentId", "emoji"],
  unreact: ["commentId", "emoji"],
  delete: ["commentId"],
};

type ManageCommentInput = {
  action: "create" | "edit" | "resolve" | "reopen" | "react" | "unreact" | "delete";
  targetType?: CommentTarget;
  targetId?: string;
  body?: string;
  parentId?: string;
  anchor?: { from: string; to: string };
  versionId?: string;
  commentId?: string;
  emoji?: string;
};

async function canCommentOnTarget(callerId: string, targetType: CommentTarget, targetId: string): Promise<boolean> {
  if (targetType === "pagedoc") return isLabMember(callerId);
  if (targetType === "doc") {
    const access = await getPageAccess(callerId, targetId);
    return access.canComment;
  }
  // file: Core or project member
  if (await isCore(callerId)) return true;
  const file = await prisma.projectFile.findUnique({ where: { id: targetId }, select: { projectId: true } });
  if (!file || !file.projectId) return false;
  return isProjectMember(callerId, file.projectId);
}

async function requireComment(commentId: string) {
  const comment = await prisma.docComment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, targetType: true, targetId: true, parentId: true },
  });
  if (!comment) throw new ManageCommentError("Comment not found", 404);
  return comment;
}

export async function runManageComment(callerId: string, input: ManageCommentInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  if (input.action === "create") {
    const targetType = input.targetType!;
    const targetId = input.targetId!;
    const body = input.body!.trim();
    if (!body) throw new ManageCommentError("Body is required", 400);
    if (body.length > 5000) throw new ManageCommentError("Body too long", 400);

    if (!(await canCommentOnTarget(callerId, targetType, targetId))) {
      throw new ManageCommentError("Forbidden", 403);
    }

    // Validate target exists
    let targetExists = false;
    if (targetType === "doc") {
      const page = await prisma.page.findUnique({ where: { id: targetId }, select: { archivedAt: true } });
      targetExists = !!page && page.archivedAt === null;
    } else if (targetType === "pagedoc") {
      const doc = await prisma.pageDoc.findUnique({ where: { id: targetId }, select: { id: true } });
      targetExists = doc !== null;
    } else {
      const file = await prisma.projectFile.findUnique({ where: { id: targetId }, select: { archivedAt: true } });
      targetExists = !!file && file.archivedAt === null;
    }
    if (!targetExists) throw new ManageCommentError("Target not found", 404);

    // Validate parentId (replies must point at a root comment on same target)
    if (input.parentId) {
      const parent = await prisma.docComment.findUnique({
        where: { id: input.parentId },
        select: { targetType: true, targetId: true, parentId: true },
      });
      if (!parent || parent.targetType !== targetType || parent.targetId !== targetId || parent.parentId !== null) {
        throw new ManageCommentError("Invalid parent comment", 400);
      }
    }

    const anchor = targetType === "doc" ? (input.anchor ?? null) : null;

    // For file comments, resolve versionId
    let versionId: string | null = null;
    if (targetType === "file") {
      if (input.versionId) {
        const version = await prisma.projectFileVersion.findFirst({
          where: { id: input.versionId, fileId: targetId },
          select: { id: true },
        });
        if (!version) throw new ManageCommentError("Invalid version", 400);
        versionId = version.id;
      } else {
        versionId =
          (
            await prisma.projectFile.findUnique({
              where: { id: targetId },
              select: { currentVersionId: true },
            })
          )?.currentVersionId ?? null;
      }
    }

    const created = await prisma.docComment.create({
      data: {
        targetType,
        targetId,
        parentId: input.parentId ?? null,
        authorId: callerId,
        body,
        ...(anchor !== null ? { anchor } : {}),
        fileId: targetType === "file" ? targetId : null,
        versionId,
      },
      select: { id: true },
    });

    if (targetType === "doc") publishCommentChange(targetId);
    return { id: created.id };
  }

  const comment = await requireComment(input.commentId!);
  const isAuthor = comment.authorId === callerId;
  const core = await isCore(callerId);

  if (input.action === "edit") {
    if (!isAuthor) throw new ManageCommentError("Only the comment author can edit it", 403);
    const body = input.body!.trim();
    if (!body) throw new ManageCommentError("Body is required", 400);
    await prisma.docComment.update({ where: { id: comment.id }, data: { body } });
    if (comment.targetType === "doc") publishCommentChange(comment.targetId);
    return { ok: true };
  }

  if (input.action === "delete") {
    const canDelete = comment.targetType === "file" ? core : core || isAuthor;
    if (!canDelete) throw new ManageCommentError("Forbidden", 403);
    await prisma.docComment.delete({ where: { id: comment.id } });
    if (comment.targetType === "doc") publishCommentChange(comment.targetId);
    return { ok: true };
  }

  if (input.action === "react" || input.action === "unreact") {
    const emoji = input.emoji!.trim();
    if (!emoji) throw new ManageCommentError("Emoji is required", 400);
    // doc targets require canComment; file/pagedoc just require being an authenticated caller
    if (comment.targetType === "doc") {
      const access = await getPageAccess(callerId, comment.targetId);
      if (!access.canComment) throw new ManageCommentError("Forbidden", 403);
    }
    if (input.action === "react") {
      await prisma.docCommentReaction.upsert({
        where: { commentId_userId_emoji: { commentId: comment.id, userId: callerId, emoji } },
        create: { commentId: comment.id, userId: callerId, emoji },
        update: {},
      });
    } else {
      await prisma.docCommentReaction.deleteMany({
        where: { commentId: comment.id, userId: callerId, emoji },
      });
    }
    return { ok: true };
  }

  // resolve / reopen
  if (comment.targetType === "pagedoc") {
    const pageDoc = await prisma.pageDoc.findUnique({
      where: { id: comment.targetId },
      select: { maintainerId: true },
    });
    // pagedoc: maintainer or Core may resolve/reopen
    if (!pageDoc || (pageDoc.maintainerId !== callerId && !core)) {
      throw new ManageCommentError("Forbidden", 403);
    }
  } else if (comment.targetType === "doc") {
    const access = await getPageAccess(callerId, comment.targetId);
    if (!access.canResolve) throw new ManageCommentError("Forbidden", 403);
  } else {
    // file
    if (!core) throw new ManageCommentError("Forbidden", 403);
  }

  await prisma.docComment.update({
    where: { id: comment.id },
    data: { resolvedAt: input.action === "resolve" ? new Date() : null },
  });
  if (comment.targetType === "doc") publishCommentChange(comment.targetId);
  return { ok: true };
}

export const MANAGE_COMMENT: McpTool = {
  def: MANAGE_COMMENT_TOOL_DEF,
  run: (ctx: McpCtx, args) =>
    runManageComment(ctx.user.id, args as unknown as ManageCommentInput),
};
