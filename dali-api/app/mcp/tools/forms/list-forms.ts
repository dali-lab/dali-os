// MCP tool: list_forms — every form with its Drive folder placement.
// Scope: mcp:read; forms you can view.

import { prisma } from "~/lib/db.server";
import { canSeeForm } from "~/forms/lib/form-access.server";
import { McpForbiddenError, type McpCtx, type McpTool } from "../../registry";
import { pageArray, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_FORMS_TOOL = {
  name: "list_forms",
  description:
    "List every form: id, name, folderPageId (the Drive Page folder it lives in, null = top level), version count, and publish state, for the forms you can view. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: { ...pageProps(PAGE_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListForms(ctx: McpCtx, args: PageArgs = {}) {
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
  const visible = (await Promise.all(all.map((f) => canSeeForm(ctx.user.id, f.id)))).flatMap((ok, i) =>
    ok ? [all[i]] : [],
  );
  const { rows, page } = pageArray(visible, args, PAGE_LIMITS);
  return {
    page,
    forms: rows.map((f) => ({
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
  run: (ctx: McpCtx, args) => runListForms(ctx, args as PageArgs),
};
