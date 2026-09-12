// MCP `list_page_templates` — list FreeForm template pages in a workspace scope.
// Mirrors GET /api/page-templates: returns only templates the caller can access.

import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import type { WorkspaceType } from "~/generated/prisma/client";

export const LIST_PAGE_TEMPLATES_TOOL = {
  name: "list_page_templates",
  description:
    "List page templates available in a workspace scope (Lab or Project). Returns FreeForm pages marked as templates that the caller can access. Use the returned id with manage_page action=duplicate to create a page from a template.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workspaceType: {
        type: "string",
        enum: ["Lab", "Project"],
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

type Input = { workspaceType: "Lab" | "Project"; workspaceId?: string };

async function canViewWorkspace(callerId: string, workspaceType: string, workspaceId: string | null): Promise<boolean> {
  if (await isCore(callerId)) return true;
  if (workspaceType === "Lab") return isLabMember(callerId);
  if (workspaceType === "Project" && workspaceId) return isProjectMember(callerId, workspaceId);
  return false;
}

export async function runListPageTemplates(callerId: string, input: Input) {
  if (input.workspaceType === "Project" && !input.workspaceId) {
    throw new ListPageTemplatesError("workspaceId is required for Project scope", 400);
  }

  const workspaceId = input.workspaceId ?? null;
  const canAccess = await canViewWorkspace(callerId, input.workspaceType, workspaceId);
  if (!canAccess) return { templates: [] };

  const templates = await prisma.page.findMany({
    where: {
      workspaceType: input.workspaceType as WorkspaceType,
      workspaceId,
      isTemplate: true,
      archivedAt: null,
      kind: "FreeForm",
    },
    orderBy: { title: "asc" },
    select: { id: true, title: true, iconEmoji: true },
  });

  return {
    templates: templates.map((t) => ({
      id: t.id,
      title: t.title ?? "",
      iconEmoji: t.iconEmoji ?? null,
    })),
  };
}
