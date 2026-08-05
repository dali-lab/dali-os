// MCP `list_email_templates` — returns all email templates with their version
// history. Mirrors the admin.email-templates.tsx loader.
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_EMAIL_TEMPLATES_TOOL = {
  name: "list_email_templates",
  description:
    "List all email templates with their full version history (subject, body, author, version number). " +
    "Templates are ordered newest first; versions within each template are ordered newest first. " +
    "Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListEmailTemplates(ctx: McpCtx) {
  const callerId = ctx.user.id;
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core leads can view email templates.");
  }

  const templates = await prisma.emailTemplate.findMany({
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { templates };
}
