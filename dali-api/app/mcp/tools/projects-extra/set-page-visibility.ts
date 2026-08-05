// MCP `set_page_visibility` — toggle a project page's partner or public
// visibility flag.
//
// Mirrors POST /api/pages/:id/partner-visible and POST /api/pages/:id/public-visible
// via the shared handlePageVisibility helper, but calls the DB directly so the
// MCP layer doesn't need to manufacture a Request object.
//
// Gate: canEditProject (Core or project member). The page must be in a Project
// workspace and must not be archived.

import { prisma } from "~/lib/db";
import { McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction } from "./errors";
import { canEditProject } from "../access";

export const SET_PAGE_VISIBILITY_TOOL = {
  name: "set_page_visibility",
  description:
    "Set a project page's partner or public visibility. action: 'partner' toggles the flag that shares the page with the partner portal; 'public' toggles the public write-up flag.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["partner", "public"],
        description: "'partner' or 'public'.",
      },
      pageId: { type: "string", minLength: 1, description: "Page.id." },
      visible: { type: "boolean", description: "true to show, false to hide." },
    },
    required: ["action", "pageId", "visible"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type SetPageVisibilityInput = { action: string; pageId: string; visible: boolean };

export async function runSetPageVisibility(
  callerId: string,
  input: SetPageVisibilityInput,
): Promise<{ ok: true }> {
  requireForAction(input.action, input, {
    partner: ["pageId", "visible"],
    public: ["pageId", "visible"],
  });

  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: { id: true, workspaceType: true, workspaceId: true, archivedAt: true },
  });

  if (!page || page.workspaceType !== "Project" || page.workspaceId === null) {
    throw new McpNotFoundError("Page not found or is not in a project workspace.");
  }
  if (page.archivedAt !== null) {
    throw new McpInvalidError("Page is archived and cannot be modified.");
  }

  if (!(await canEditProject(callerId, page.workspaceId))) {
    throw new McpForbiddenError("You don't have permission to edit this project.");
  }

  const field = input.action === "partner" ? "partnerVisible" : "publicVisible";
  await prisma.page.update({ where: { id: page.id }, data: { [field]: input.visible } });

  return { ok: true };
}
