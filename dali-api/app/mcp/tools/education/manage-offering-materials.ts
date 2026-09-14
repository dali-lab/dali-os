// MCP tool: manage_offering_materials — create, move-page, move-file, and
// set-material-session for offering materials (instructor/Core only).
// Reuses createMaterialPage, moveMaterialPage, moveMaterialFile from lms.server.ts
// and the set-material-session prisma update from the manage route (inline here,
// matching what the route does: prisma.page.update({ data: { sessionId } })).
// Gate: isOfferingManager.
// Scope: mcp:write.

import {
  createMaterialPage,
  moveMaterialPage,
  moveMaterialFile,
} from "~/education/lib/lms.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_OFFERING_MATERIALS_TOOL = {
  name: "manage_offering_materials",
  description:
    "Create pages/folders, move material pages into folders, move uploaded files, or assign a page to a session in an offering's materials. Instructor or Core only. Actions: create_page · move_page · move_file · set_material_session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create_page", "move_page", "move_file", "set_material_session"],
      },
      offeringId: { type: "string", minLength: 1 },
      title: {
        type: "string",
        description: "create_page: page title.",
      },
      kind: {
        type: "string",
        enum: ["FreeForm", "Folder"],
        description: "create_page: 'FreeForm' (default) or 'Folder'. Folders stay top-level.",
      },
      parentPageId: {
        type: "string",
        description:
          "create_page / move_page: place inside this folder. Omit for top-level.",
      },
      studentEditable: {
        type: "boolean",
        description:
          "create_page: if true, creates a collaborative workspace doc (Workspace tab) rather than a read-only material.",
      },
      sessionId: {
        type: "string",
        description:
          "create_page / set_material_session: associate with this session (null to make offering-wide).",
      },
      pageId: {
        type: "string",
        description: "move_page / set_material_session: target page ID.",
      },
      fileId: {
        type: "string",
        description: "move_file: target file ID.",
      },
      folderId: {
        type: "string",
        description:
          "move_file: destination folder page ID. Omit or null to move to the offering root.",
      },
    },
    required: ["action", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  action: string;
  offeringId: string;
  title?: string;
  kind?: "FreeForm" | "Folder";
  parentPageId?: string | null;
  studentEditable?: boolean;
  sessionId?: string | null;
  pageId?: string;
  fileId?: string;
  folderId?: string | null;
};

export async function runManageOfferingMaterials(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, {
    create_page: ["title"],
    move_page: ["pageId"],
    move_file: ["fileId"],
    set_material_session: ["pageId"],
  });

  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  switch (args.action) {
    case "create_page": {
      const result = await createMaterialPage({
        offeringId: args.offeringId,
        title: args.title!,
        kind: args.kind ?? "FreeForm",
        parentPageId: args.parentPageId ?? null,
        studentEditable: args.studentEditable ?? false,
        sessionId: args.sessionId ?? null,
        actorId: ctx.user.id,
      });
      if ("error" in result) {
        if (result.status === 404) throw new McpNotFoundError(result.error);
        throw new McpInvalidError(result.error);
      }
      return { ok: true, id: result.id };
    }

    case "move_page": {
      const result = await moveMaterialPage({
        offeringId: args.offeringId,
        pageId: args.pageId!,
        parentPageId: args.parentPageId ?? null,
        actorId: ctx.user.id,
      });
      if ("error" in result) {
        if (result.status === 404) throw new McpNotFoundError(result.error);
        throw new McpInvalidError(result.error);
      }
      return { ok: true };
    }

    case "move_file": {
      const result = await moveMaterialFile({
        offeringId: args.offeringId,
        fileId: args.fileId!,
        folderId: args.folderId ?? null,
        actorId: ctx.user.id,
      });
      if ("error" in result) {
        if (result.status === 404) throw new McpNotFoundError(result.error);
        throw new McpInvalidError(result.error);
      }
      return { ok: true };
    }

    case "set_material_session": {
      // The manage route does this inline: prisma.page.update({ data: { sessionId } }).
      // Validate that the page belongs to this offering first.
      const page = await prisma.page.findUnique({
        where: { id: args.pageId! },
        select: { workspaceType: true, workspaceId: true },
      });
      if (
        !page ||
        page.workspaceType !== "EducationOffering" ||
        page.workspaceId !== args.offeringId
      ) {
        throw new McpNotFoundError("Page not found in this offering");
      }
      // Validate the session belongs to this offering when provided.
      if (args.sessionId) {
        const session = await prisma.educationSession.findUnique({
          where: { id: args.sessionId },
          select: { offeringId: true },
        });
        if (!session || session.offeringId !== args.offeringId) {
          throw new McpNotFoundError("Session not found in this offering");
        }
      }
      await prisma.page.update({
        where: { id: args.pageId! },
        data: { sessionId: args.sessionId ?? null },
      });
      return { ok: true };
    }
  }
}

export const MANAGE_OFFERING_MATERIALS: McpTool = {
  def: MANAGE_OFFERING_MATERIALS_TOOL,
  run: (ctx: McpCtx, args) => runManageOfferingMaterials(ctx, args as Args),
};
