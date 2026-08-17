// MCP tool: list_forms — every form with its Drive folder placement.
// Scope: mcp:read, Core only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { McpForbiddenError, type McpCtx, type McpTool } from "../../registry";

export const LIST_FORMS_TOOL = {
  name: "list_forms",
  description:
    "List every form: id, name, folderPageId (the Drive Page folder it lives in, null = top level), version count, and publish state. Core only.",
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
  const forms = await prisma.form.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      folderPageId: true,
      published: true,
      publicToken: true,
      _count: { select: { versions: true } },
    },
  });
  return {
    forms: forms.map((f) => ({
      id: f.id,
      name: f.name,
      folderPageId: f.folderPageId,
      versionCount: f._count.versions,
      published: f.published,
      publicToken: f.publicToken,
    })),
  };
}

export const LIST_FORMS: McpTool = {
  def: LIST_FORMS_TOOL,
  run: (ctx: McpCtx, _args) => runListForms(ctx),
};
