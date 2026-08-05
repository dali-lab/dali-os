// MCP tool: list_mentor_note_templates — list all mentor note templates.
// Scope: mcp:read. Visibility: any lab mentor or Core (same gate as the route).
// Mirrors the logic in api.mentorship.templates.ts GET handler.

import { prisma } from "~/lib/db";
import { canViewMentorship } from "~/mentorship/lib/visibility";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError } from "../../registry";

export const LIST_MENTOR_NOTE_TEMPLATES_TOOL = {
  name: "list_mentor_note_templates",
  description:
    "List all mentor note templates (name, id, isDefault, lastUpdatedBy). Any lab mentor or Core member can read. The default template is the one seeded into new notes.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMentorNoteTemplates(callerId: string): Promise<unknown> {
  if (!(await canViewMentorship(callerId))) {
    throw new McpForbiddenError(
      "Only lab mentors and Core members can list mentor note templates",
    );
  }

  const templates = await prisma.mentorNoteTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      updatedAt: true,
      lastUpdatedBy: true,
    },
  });

  return {
    templates: templates.map((t) => ({
      ...t,
      updatedAt: t.updatedAt.toISOString(),
    })),
  };
}

export const LIST_MENTOR_NOTE_TEMPLATES: McpTool = {
  def: LIST_MENTOR_NOTE_TEMPLATES_TOOL,
  run: (ctx: McpCtx, _args) => runListMentorNoteTemplates(ctx.user.id),
};
