// MCP tool: list_forms — every form with its Drive folder placement.
// Scope: mcp:read, Core only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { canSeeForm, formsUsePageAccess } from "~/forms/lib/form-access.server";
import { McpForbiddenError, type McpCtx, type McpTool } from "../../registry";

export const LIST_FORMS_TOOL = {
  name: "list_forms",
  description:
    "List every form: id, name, folderPageId (the Drive Page folder it lives in, null = top level), version count, and publish state. Core only; once forms follow page access, the forms you can view.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListForms(ctx: McpCtx) {
  const byPage = await formsUsePageAccess();
  if (!byPage && !(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can list forms");
  }
  const all = await prisma.form.findMany({
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
  const visible = byPage
    ? (await Promise.all(all.map((f) => canSeeForm(ctx.user.id, f.id)))).flatMap((ok, i) => (ok ? [all[i]] : []))
    : all;
  return {
    forms: visible.map((f) => ({
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
