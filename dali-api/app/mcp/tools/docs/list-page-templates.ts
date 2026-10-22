// MCP `list_page_templates` — list FreeForm template pages in a workspace scope.
// Mirrors GET /api/page-templates: returns only templates the caller can access.

import { listPageTemplates } from "~/lib/page-templates.server";

export const LIST_PAGE_TEMPLATES_TOOL = {
  name: "list_page_templates",
  description:
    "List page templates available in a workspace scope: Lab, Project, or Member (the caller's own private templates). Returns FreeForm pages marked as templates that the caller can access. Use the returned id with manage_page action=duplicate to create a page from a template.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workspaceType: {
        type: "string",
        enum: ["Lab", "Project", "Member"],
        description: "Workspace scope to list templates for.",
      },
      workspaceId: {
        type: "string",
        description: "Required when workspaceType is 'Project'.",
      },
    },
    required: ["workspaceType"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export class ListPageTemplatesError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ListPageTemplatesError";
  }
}

type Input = { workspaceType: "Lab" | "Project" | "Member"; workspaceId?: string };

export async function runListPageTemplates(callerId: string, input: Input) {
  if (input.workspaceType === "Project" && !input.workspaceId) {
    throw new ListPageTemplatesError("workspaceId is required for Project scope", 400);
  }
  const workspaceId = input.workspaceType === "Member" ? null : input.workspaceId ?? null;
  return { templates: await listPageTemplates(callerId, input.workspaceType, workspaceId) };
}
