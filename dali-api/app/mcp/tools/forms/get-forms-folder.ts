// MCP tool: get_forms_folder — contents of one folder by ID.
// Scope: mcp:read, Core only.

import { loadFormsLevel } from "~/forms/lib/forms-data";
import { isCore } from "~/lib/roles";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GET_FORMS_FOLDER_TOOL = {
  name: "get_forms_folder",
  description:
    "Get the contents of a forms folder by ID: child folders, forms, breadcrumb trail, and current folder info. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      folderId: {
        type: "string",
        description: "The folder ID to load.",
      },
    },
    required: ["folderId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { folderId: string };

export async function runGetFormsFolder(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can view forms folders");
  }
  const level = await loadFormsLevel(args.folderId);
  if (!level) {
    throw new McpNotFoundError(`Folder not found: ${args.folderId}`);
  }
  return {
    current: level.current,
    crumbs: level.crumbs,
    folders: level.folders,
    forms: level.forms,
    allFolders: level.allFolders,
    allForms: level.allForms,
  };
}

export const GET_FORMS_FOLDER: McpTool = {
  def: GET_FORMS_FOLDER_TOOL,
  run: (ctx: McpCtx, args) => runGetFormsFolder(ctx, args as Args),
};
