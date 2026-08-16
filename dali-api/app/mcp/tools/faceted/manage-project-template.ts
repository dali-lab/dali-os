// MCP `manage_project_template` — faceted router over the project-template
// lifecycle: capture a project into a reusable blueprint, list templates,
// instantiate a new project from one, and delete. Core only.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, McpForbiddenError, requireForAction } from "../../errors";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import {
  captureProjectTemplate,
  instantiateProjectTemplate,
} from "~/lib/project-templates.server";

const MANAGE_PROJECT_TEMPLATE_DEF = {
  name: "manage_project_template",
  description: `Manage project templates (Core only). Pass \`action\`:
- \`capture\`: save an existing project's structure (epics, user stories, sprints, tasks, checklists) as a reusable template. Requires: projectId, name.
- \`list\`: list available project templates.
- \`instantiate\`: create a new project pre-populated from a template. Requires: templateId, name.
- \`delete\`: delete a project template. Requires: templateId.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["capture", "list", "instantiate", "delete"],
        description: "Operation to perform.",
      },
      projectId: { type: "string", description: "capture: the source project." },
      templateId: { type: "string", description: "instantiate/delete: the template." },
      name: {
        type: "string",
        maxLength: 200,
        description: "capture: the template name. instantiate: the new project's name.",
      },
      description: { type: "string", maxLength: 2000, description: "capture: optional template description." },
      includeOverviewPage: {
        type: "boolean",
        description: "capture: also carry the project's Overview page as a starting doc (default false).",
      },
      startDate: {
        type: "string",
        description: "instantiate: ISO date to rebase sprint timelines onto (default today).",
      },
      initialTermId: { type: "string", description: "instantiate: optional first term for the new project." },
      partnerOrgId: { type: "string", description: "instantiate: optional partner org to link." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  capture: ["projectId", "name"],
  list: [],
  instantiate: ["templateId", "name"],
  delete: ["templateId"],
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  if (!(await isCore(ctx.user.id))) throw new McpForbiddenError("Core only");

  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  switch (action) {
    case "capture":
      return captureProjectTemplate({
        projectId: args.projectId as string,
        name: args.name as string,
        description: (args.description as string | undefined) ?? null,
        createdBy: ctx.user.id,
        includeOverviewPage: Boolean(args.includeOverviewPage),
      });

    case "list": {
      const rows = await prisma.projectTemplate.findMany({
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, description: true, iconEmoji: true, isDefault: true, createdAt: true },
      });
      return { templates: rows };
    }

    case "instantiate": {
      const startDate = args.startDate ? new Date(args.startDate as string) : undefined;
      if (startDate && Number.isNaN(startDate.getTime())) {
        throw new McpInvalidError("startDate is not a valid date");
      }
      return instantiateProjectTemplate({
        templateId: args.templateId as string,
        name: args.name as string,
        createdBy: ctx.user.id,
        startDate,
        initialTermId: (args.initialTermId as string | undefined) || null,
        partnerOrgId: (args.partnerOrgId as string | undefined) || null,
      });
    }

    case "delete":
      await prisma.projectTemplate.delete({ where: { id: args.templateId as string } });
      return { ok: true };

    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_PROJECT_TEMPLATE_TOOL: McpTool = { def: MANAGE_PROJECT_TEMPLATE_DEF, run };
