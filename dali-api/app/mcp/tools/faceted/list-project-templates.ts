import type { McpTool, McpCtx } from "../../registry";
import { McpForbiddenError } from "../../errors";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";

const LIST_PROJECT_TEMPLATES_DEF = {
  name: "list_project_templates",
  description: "List available project templates (Core only).",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

async function run(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) throw new McpForbiddenError("Core only");
  const rows = await prisma.projectTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, iconEmoji: true, isDefault: true, createdAt: true },
  });
  return { templates: rows };
}

export const LIST_PROJECT_TEMPLATES_TOOL: McpTool = { def: LIST_PROJECT_TEMPLATES_DEF, run };
