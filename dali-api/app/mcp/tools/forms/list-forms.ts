// MCP tool: list_forms — top-level forms tree (root folders + forms).
// Scope: mcp:read, Core only.

import { loadFormsLevel } from "~/forms/lib/forms-data";
import { isCore } from "~/lib/roles";
import { McpForbiddenError, type McpCtx, type McpTool } from "../../registry";

export const LIST_FORMS_TOOL = {
  name: "list_forms",
  description:
    "List the top-level forms tree: folders and forms at the root level. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListForms(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can list forms");
  }
  const level = await loadFormsLevel(null);
  // level is never null for folderId=null
  const result = level!;
  return {
    folders: result.folders,
    forms: result.forms,
    allFolders: result.allFolders,
    allForms: result.allForms,
  };
}

export const LIST_FORMS: McpTool = {
  def: LIST_FORMS_TOOL,
  run: (ctx: McpCtx, _args) => runListForms(ctx),
};
