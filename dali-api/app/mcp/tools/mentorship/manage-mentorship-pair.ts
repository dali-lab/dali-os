// MCP tool: manage_mentorship_pair — faceted write tool for mentor–mentee pairs.
// Scope: mcp:write. Both create and delete are Core-only (mirrors api.mentorship.pairs.ts).
//
// Actions:
//   create — assign a mentee's mentor. Core only. One mentor per mentee per
//             (project, term, domain): if the mentee is already paired in that
//             domain the existing row is reassigned instead of adding a second.
//             Returns {id, created}.
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
    // One mentor per mentee per (project, term, domain): reassign an existing
    // pairing (collapsing any stray extras) instead of adding a second mentor.
    const existing = await prisma.mentorshipPair.findMany({
      where: {
        menteeUserId: input.menteeUserId!,
        projectId: input.projectId!,
        termId: input.termId!,
        domainId: input.domainId!,
      },
      select: { id: true },
    });
    if (existing.length > 0) {
      const [keep, ...extra] = existing;
      if (extra.length > 0) {
        await prisma.mentorshipPair.deleteMany({
          where: { id: { in: extra.map((e) => e.id) } },
        });
      }
      const updated = await prisma.mentorshipPair.update({
        where: { id: keep.id },
        data: { mentorUserId: input.mentorUserId!, manual: true },
        select: { id: true },
      });
      return { id: updated.id, created: false };
    }

    const created = await prisma.mentorshipPair.create({
      data: {
        menteeUserId: input.menteeUserId!,
        mentorUserId: input.mentorUserId!,
        projectId: input.projectId!,
        termId: input.termId!,
        domainId: input.domainId!,
        // Hand-created via MCP — mark manual so it survives a staffing
        // re-finalize (mirrors api.mentorship.pairs.ts).
        manual: true,
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
