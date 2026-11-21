import { prisma } from "~/lib/db.server";
import { isLabMemberOrAlum } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditProject } from "~/mcp/tools/access";
import { requireForAction } from "~/mcp/registry";
import { duplicatePage } from "~/drive/lib/page-copy.server";
import { setFavorite } from "~/lib/user-pages.server";
import { logAuditEvent } from "~/lib/audit";
import { movePage } from "~/drive/lib/page-move.server";
import { runUpdatePage } from "~/mcp/tools/update-page";
import { runSetPageVisibility } from "~/mcp/tools/projects-extra/set-page-visibility";
import type { McpCtx, McpTool } from "~/mcp/registry";

export const MANAGE_PAGE_TOOL_DEF = {
  name: "manage_page",
  description:
    "Manage a page: update (rename or set the icon of any doc, note, notebook or folder you can edit; archive or restore a project page), set_visibility (share a project page with the partner portal, or make it the public write-up), pin/unpin, move/reorder, duplicate, favorite/unfavorite, toggle template status, or update typography display settings. Permissions mirror the web (rename and icon follow the page's own edit access, the same as the web; archive, restore and set_visibility require Core or being staffed on the project; pin requires project-edit or lab-member; move requires manage access; duplicate/set_template requires edit access; favorite requires view access; typography requires edit access on a FreeForm page).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["update", "set_visibility", "pin", "move", "duplicate", "favorite", "set_template", "typography"],
      },
      pageId: { type: "string", minLength: 1, description: "Required for all actions." },
      // update
      title: { type: "string", minLength: 1, maxLength: 200, description: "For 'update': new title." },
      iconEmoji: { type: "string", maxLength: 8, description: "For 'update': empty string clears the icon." },
      archived: { type: "boolean", description: "For 'update': true archives (soft-deletes) the page, false restores it." },
      // set_visibility
      audience: {
        type: "string",
        enum: ["partner", "public"],
        description: "For 'set_visibility': 'partner' shares the page with the partner portal; 'public' makes it the public write-up.",
      },
      visible: { type: "boolean", description: "For 'set_visibility': true to show, false to hide." },
      // pin
      pinned: { type: "boolean", description: "For 'pin': true to pin, false to unpin." },
      // move
      parentPageId: {
        type: ["string", "null"],
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
      // typography
      font: {
        type: "string",
        enum: ["default", "serif", "mono"],
        description: "For 'typography': page font family.",
      },
      smallText: { type: "boolean", description: "For 'typography': reduce text size." },
      fullWidth: { type: "boolean", description: "For 'typography': expand to full container width." },
      nestingGuides: { type: "boolean", description: "For 'typography': show nesting indentation guides." },
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
  update: [],
  set_visibility: ["audience", "visible"],
  pin: ["pinned"],
  move: [],
  duplicate: [],
  favorite: ["favorited"],
  set_template: ["isTemplate"],
  typography: ["font", "smallText", "fullWidth"],
};

type ManagePageInput = {
  action: "update" | "set_visibility" | "pin" | "move" | "duplicate" | "favorite" | "set_template" | "typography";
  pageId: string;
  title?: string;
  iconEmoji?: string;
  archived?: boolean;
  audience?: "partner" | "public";
  visible?: boolean;
  pinned?: boolean;
  parentPageId?: string | null;
  beforeId?: string;
  workspaceType?: "Lab" | "Project";
  workspaceId?: string;
  favorited?: boolean;
  isTemplate?: boolean;
  font?: "default" | "serif" | "mono";
  smallText?: boolean;
  fullWidth?: boolean;
  nestingGuides?: boolean;
};

export async function runManagePage(callerId: string, input: ManagePageInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  if (input.action === "update") {
    const { pageId, title, iconEmoji, archived } = input;
    return runUpdatePage(callerId, { pageId, title, iconEmoji, archived });
  }

  if (input.action === "set_visibility") {
    return runSetPageVisibility(callerId, { action: input.audience!, pageId: input.pageId, visible: input.visible! });
  }

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

  if (input.action === "typography") {
    const page = await prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceType: true, workspaceId: true, archivedAt: true, kind: true },
    });
    if (!page || page.archivedAt !== null) throw new ManagePageError("Page not found", 404);
    if (page.kind !== "FreeForm") {
      throw new ManagePageError("Only FreeForm pages have typography settings", 400);
    }
    const access = await getPageAccess(callerId, {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      archivedAt: page.archivedAt,
    });
    if (!access.canEdit) throw new ManagePageError("Permission denied", 403);
    await prisma.page.update({
      where: { id: input.pageId },
      data: {
        typography: {
          font: input.font!,
          smallText: input.smallText!,
          fullWidth: input.fullWidth!,
          nestingGuides: input.nestingGuides ?? false,
        },
      },
    });
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
      if (!(await isLabMemberOrAlum(callerId))) throw new ManagePageError("Forbidden", 403);
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

  const result = await movePage({
    pageId: input.pageId,
    userId: callerId,
    input: {
      parentPageId: input.parentPageId ?? null,
      beforeId: input.beforeId ?? null,
      ...(input.workspaceType
        ? { workspaceType: input.workspaceType, workspaceId: input.workspaceType === "Lab" ? null : (input.workspaceId ?? null) }
        : {}),
    },
  });
  if (result.ok) return { ok: true, clearedReceivers: result.clearedReceivers };
  if ("response" in result) {
    const body = (await result.response.json().catch(() => ({}))) as { error?: string };
    throw new ManagePageError(body.error ?? "Couldn't move this document", result.response.status);
  }
  throw new ManagePageError(result.error, result.status);
}

export const MANAGE_PAGE: McpTool = {
  def: MANAGE_PAGE_TOOL_DEF,
  run: (ctx: McpCtx, args) =>
    runManagePage(ctx.user.id, args as unknown as ManagePageInput),
};
