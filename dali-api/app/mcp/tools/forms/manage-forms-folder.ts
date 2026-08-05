// MCP tool: manage_forms_folder — create, rename, move, or delete a forms folder.
// All mutations go through runFormsAction.
// Scope: mcp:admin, Core only.

import { runFormsAction } from "~/forms/lib/forms-data";
import { isCore } from "~/lib/roles";
import {
  requireForAction,
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_FORMS_FOLDER_TOOL = {
  name: "manage_forms_folder",
  description:
    "Create, rename, move, or delete a forms folder. Actions: create · rename · move · delete. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "rename", "move", "delete"],
        description: "The folder management action to perform.",
      },
      folderId: {
        type: "string",
        description: "Required for rename / move / delete.",
      },
      name: {
        type: "string",
        description: "Folder name (create / rename).",
      },
      parentId: {
        type: "string",
        description: "Parent folder ID (create / move). Empty string = top level.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["name"],
  rename: ["folderId", "name"],
  move: ["folderId"],
  delete: ["folderId"],
};

const ACTION_INTENT: Record<string, string> = {
  create: "create-folder",
  rename: "rename-folder",
  move: "move-folder",
  delete: "delete-folder",
};

type Args = {
  action: string;
  folderId?: string;
  name?: string;
  parentId?: string;
};

export async function runManageFormsFolder(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can manage forms folders");
  }

  requireForAction(args.action, args, ACTION_REQUIRED);

  const intent = ACTION_INTENT[args.action];
  const fd = new FormData();
  fd.set("intent", intent);

  if (args.folderId) fd.set("id", args.folderId);
  if (args.name !== undefined) fd.set("name", args.name);
  if (args.parentId !== undefined) fd.set("parentId", args.parentId);

  const result = await runFormsAction(fd, ctx.user.id);

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const MANAGE_FORMS_FOLDER: McpTool = {
  def: MANAGE_FORMS_FOLDER_TOOL,
  run: (ctx: McpCtx, args) => runManageFormsFolder(ctx, args as Args),
};
