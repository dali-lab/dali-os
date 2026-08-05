// MCP tool: manage_mentorship_pair — faceted write tool for mentor–mentee pairs.
// Scope: mcp:write. Both create and delete are Core-only (mirrors api.mentorship.pairs.ts).
//
// Actions:
//   create — manually create a pair. Core only. Dupe-checked (no unique constraint
//             on model — checks before inserting). Returns {id, created}.
//   delete  — delete pairs by id. Core only. Supports a single id per call.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, requireForAction } from "../../registry";

export const MANAGE_MENTORSHIP_PAIR_TOOL = {
  name: "manage_mentorship_pair",
  description:
    "Create or delete a mentorship pair. Both actions are Core-only. Action 'create' links a mentor to a mentee for a project/term/domain (dupe-safe). Action 'delete' removes an existing pair by id.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "delete"],
        description: "What to do.",
      },
      // create fields
      menteeUserId: {
        type: "string",
        description: "Mentee user id. Required for action=create.",
      },
      mentorUserId: {
        type: "string",
        description: "Mentor user id. Required for action=create.",
      },
      projectId: {
        type: "string",
        description: "Project id. Required for action=create.",
      },
      termId: {
        type: "string",
        description: "Term id. Required for action=create.",
      },
      domainId: {
        type: "string",
        description: "Domain id. Required for action=create.",
      },
      // delete field
      id: {
        type: "string",
        description: "MentorshipPair id. Required for action=delete.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManageMentorshipPair(
  callerId: string,
  input: {
    action: string;
    menteeUserId?: string;
    mentorUserId?: string;
    projectId?: string;
    termId?: string;
    domainId?: string;
    id?: string;
  },
): Promise<unknown> {
  // Both create and delete are Core-only.
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can create or delete mentorship pairs");
  }

  requireForAction(input.action, input as Record<string, unknown>, {
    create: ["menteeUserId", "mentorUserId", "projectId", "termId", "domainId"],
    delete: ["id"],
  });

  // ── create ──────────────────────────────────────────────────────────────────
  if (input.action === "create") {
    const dupe = await prisma.mentorshipPair.findFirst({
      where: {
        menteeUserId: input.menteeUserId!,
        mentorUserId: input.mentorUserId!,
        projectId: input.projectId!,
        termId: input.termId!,
        domainId: input.domainId!,
      },
      select: { id: true },
    });
    if (dupe) return { id: dupe.id, created: false };

    const created = await prisma.mentorshipPair.create({
      data: {
        menteeUserId: input.menteeUserId!,
        mentorUserId: input.mentorUserId!,
        projectId: input.projectId!,
        termId: input.termId!,
        domainId: input.domainId!,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  // ── delete ───────────────────────────────────────────────────────────────────
  const pair = await prisma.mentorshipPair.findUnique({
    where: { id: input.id! },
    select: { id: true },
  });
  if (!pair) throw new McpNotFoundError(`Mentorship pair ${input.id} not found`);

  await prisma.mentorshipPair.delete({ where: { id: pair.id } });
  return { ok: true };
}

export const MANAGE_MENTORSHIP_PAIR: McpTool = {
  def: MANAGE_MENTORSHIP_PAIR_TOOL,
  run: (ctx: McpCtx, args) =>
    runManageMentorshipPair(ctx.user.id, args as Parameters<typeof runManageMentorshipPair>[1]),
};
