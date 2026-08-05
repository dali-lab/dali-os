// MCP `manage_page` — faceted page management tool.
// Actions: pin · move · duplicate · favorite · set_template.

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditProject } from "~/mcp/tools/access";
import { requireForAction } from "~/mcp/registry";
import { duplicatePage } from "~/lib/page-copy.server";
import { setFavorite } from "~/lib/user-pages.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { logAuditEvent } from "~/lib/audit";
import type { McpCtx, McpTool } from "~/mcp/registry";
import type { Prisma } from "~/generated/prisma/client";

export const MANAGE_PAGE_TOOL_DEF = {
  name: "manage_page",
  description:
    "Manage a page: pin/unpin, move/reorder, duplicate, favorite/unfavorite, or toggle template status. Permissions mirror the web (pin requires project-edit or lab-member; move requires manage access; duplicate/set_template requires edit access; favorite requires view access).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["pin", "move", "duplicate", "favorite", "set_template"],
      },
      pageId: { type: "string", minLength: 1, description: "Required for all actions." },
      // pin
      pinned: { type: "boolean", description: "For 'pin': true to pin, false to unpin." },
      // move
      parentPageId: {
        type: "string",
        nullable: true,
        description: "For 'move': target parent folder id, or null for top-level.",
      },
      beforeId: { type: "string", description: "For 'move': place before this sibling's id." },
      workspaceType: {
        type: "string",
        enum: ["Lab", "Project"],
        description: "For 'move' cross-workspace: destination workspace type.",
      },
      workspaceId: {
        type: "string",
        description: "For 'move' to a project: the project id.",
      },
      // favorite
      favorited: { type: "boolean", description: "For 'favorite': true to add, false to remove." },
      // set_template
      isTemplate: { type: "boolean", description: "For 'set_template'." },
    },
    required: ["action", "pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export class ManagePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ManagePageError";
  }
}

const ACTION_REQUIRED: Record<string, string[]> = {
  pin: ["pinned"],
  move: [],
  duplicate: [],
  favorite: ["favorited"],
  set_template: ["isTemplate"],
};

type ManagePageInput = {
  action: "pin" | "move" | "duplicate" | "favorite" | "set_template";
  pageId: string;
  pinned?: boolean;
  parentPageId?: string | null;
  beforeId?: string;
  workspaceType?: "Lab" | "Project";
  workspaceId?: string;
  favorited?: boolean;
  isTemplate?: boolean;
};

export async function runManagePage(callerId: string, input: ManagePageInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  if (input.action === "duplicate") {
    try {
      const result = await duplicatePage({ sourcePageId: input.pageId, createdById: callerId });
      return { id: result.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      const status = message === "Permission denied" ? 403 : message === "Page not found" ? 404 : 500;
      throw new ManagePageError(message, status);
    }
  }

  if (input.action === "favorite") {
    const access = await getPageAccess(callerId, input.pageId);
    if (!access.canView) throw new ManagePageError("Document not found", 404);
    await setFavorite(callerId, input.pageId, input.favorited!);
    return { ok: true, favorited: input.favorited };
  }

  if (input.action === "set_template") {
    const page = await prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceType: true, workspaceId: true, archivedAt: true, kind: true },
    });
    if (!page || page.archivedAt !== null) throw new ManagePageError("Page not found", 404);
    if (page.kind !== "FreeForm") throw new ManagePageError("Only FreeForm pages can be templates", 400);
    const access = await getPageAccess(callerId, {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      archivedAt: page.archivedAt,
    });
    if (!access.canEdit) throw new ManagePageError("Permission denied", 403);
    await prisma.page.update({ where: { id: input.pageId }, data: { isTemplate: input.isTemplate! } });
    return { ok: true };
  }

  if (input.action === "pin") {
    const page = await prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceType: true, workspaceId: true, archivedAt: true },
    });
    if (
      !page ||
      (page.workspaceType !== "Project" && page.workspaceType !== "Lab") ||
      (page.workspaceType === "Project" && !page.workspaceId) ||
      page.archivedAt !== null
    ) {
      throw new ManagePageError("Document not found", 404);
    }
    if (page.workspaceType === "Lab") {
      if (!(await isLabMember(callerId))) throw new ManagePageError("Forbidden", 403);
    } else {
      if (!(await canEditProject(callerId, page.workspaceId!))) throw new ManagePageError("Forbidden", 403);
    }
    await prisma.page.update({
      where: { id: input.pageId },
      data: { pinnedAt: input.pinned ? new Date() : null },
    });
    await logAuditEvent({
      action: "page.pin",
      userId: callerId,
      targetId: input.pageId,
      metadata: { workspaceType: page.workspaceType, projectId: page.workspaceId, pinned: input.pinned },
    }).catch((err) => console.error("manage_page pin audit failed", err));
    return { ok: true };
  }

  // move
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      kind: true,
      archivedAt: true,
      createdById: true,
      systemKey: true,
      partnerVisible: true,
      publicVisible: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
    },
  });
  if (
    !page ||
    (page.workspaceType !== "Lab" && page.workspaceType !== "Project") ||
    page.archivedAt !== null
  ) {
    throw new ManagePageError("Document not found", 404);
  }

  let dest: { type: "Lab" | "Project"; id: string | null };
  if (!input.workspaceType) {
    dest = { type: page.workspaceType as "Lab" | "Project", id: page.workspaceId };
  } else if (input.workspaceType === "Lab") {
    dest = { type: "Lab", id: null };
  } else {
    if (!input.workspaceId) throw new ManagePageError("Project destination needs a workspaceId", 400);
    dest = { type: "Project", id: input.workspaceId };
  }
  const sameWorkspace = dest.type === page.workspaceType && dest.id === page.workspaceId;

  const canManageSource = await canManageSharing(
    { id: page.id, workspaceType: page.workspaceType, workspaceId: page.workspaceId, createdById: page.createdById },
    callerId,
  );
  if (!canManageSource) throw new ManagePageError("You can't move this document", 403);

  if (!sameWorkspace) {
    const canDest =
      dest.type === "Lab"
        ? await isLabMember(callerId)
        : (await isCore(callerId)) || (await isProjectMember(callerId, dest.id!));
    if (!canDest) throw new ManagePageError("You can't move documents into that destination", 403);
  }

  if (input.parentPageId === input.pageId) throw new ManagePageError("A document can't be moved into itself", 400);
  if (page.kind === "Folder" && input.parentPageId) {
    throw new ManagePageError("Folders can't be nested inside another folder", 400);
  }

  if (!sameWorkspace) {
    if (page.systemKey) throw new ManagePageError("This default folder can't be moved to another workspace", 400);
    if (page.projectAsOverview || page.projectAsPRD) {
      throw new ManagePageError("The Overview and PRD docs can't be moved out of their project", 400);
    }
  }

  const parentPageId: string | null = input.parentPageId ?? null;
  if (parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== dest.type ||
      parent.workspaceId !== dest.id
    ) {
      throw new ManagePageError("Folder not found", 404);
    }
    if (parent.kind !== "Folder" || parent.parentPageId !== null) {
      throw new ManagePageError("Documents can only nest inside a top-level folder", 400);
    }
  }

  // When moving a Folder cross-workspace, carry its children along.
  const childIds =
    page.kind === "Folder" && !sameWorkspace
      ? (
          await prisma.page.findMany({
            where: { parentPageId: input.pageId, archivedAt: null },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];

  // Compute the new sibling order in the destination.
  const siblings = await prisma.page.findMany({
    where: { workspaceType: dest.type, workspaceId: dest.id, parentPageId, archivedAt: null },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const order = siblings.map((s) => s.id).filter((id) => id !== input.pageId);
  const beforeIndex = input.beforeId ? order.indexOf(input.beforeId) : -1;
  if (beforeIndex >= 0) order.splice(beforeIndex, 0, input.pageId);
  else order.push(input.pageId);

  const leavesProject = page.workspaceType === "Project" && dest.type !== "Project";
  const destGeneralAccess: Prisma.PageUncheckedUpdateInput =
    dest.type === "Lab"
      ? { linkAccess: "LabMembers", linkPermission: "Edit" }
      : { linkAccess: "Restricted", linkPermission: "View" };
  const crossData: Prisma.PageUncheckedUpdateInput = sameWorkspace
    ? {}
    : {
        workspaceType: dest.type,
        workspaceId: dest.id,
        pinnedAt: null,
        ...(leavesProject ? { partnerVisible: false, publicVisible: false } : {}),
        ...destGeneralAccess,
      };
  const childData: Prisma.PageUncheckedUpdateInput = {
    workspaceType: dest.type,
    workspaceId: dest.id,
    ...(leavesProject ? { partnerVisible: false, publicVisible: false } : {}),
    ...destGeneralAccess,
  };

  await prisma.$transaction([
    prisma.page.update({ where: { id: input.pageId }, data: { parentPageId, ...crossData } }),
    ...childIds.map((id) => prisma.page.update({ where: { id }, data: childData })),
    ...order.map((id, index) => prisma.page.update({ where: { id }, data: { position: index } })),
  ]);

  if (!sameWorkspace) {
    await logAuditEvent({
      action: "page.move-workspace",
      userId: callerId,
      targetId: input.pageId,
      metadata: {
        from: { type: page.workspaceType, id: page.workspaceId },
        to: { type: dest.type, id: dest.id },
        kind: page.kind,
        childCount: childIds.length,
      },
    }).catch((err) => console.error("manage_page move audit failed", err));
  }
  return { ok: true };
}

export const MANAGE_PAGE: McpTool = {
  def: MANAGE_PAGE_TOOL_DEF,
  run: (ctx: McpCtx, args) =>
    runManagePage(ctx.user.id, args as unknown as ManagePageInput),
};
