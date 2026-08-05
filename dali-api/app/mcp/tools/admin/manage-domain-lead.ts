// MCP `manage_domain_lead` — add or remove a domain lead assignment for the
// current term. Requires the `mcp:admin` scope; caller must be an admin.

import { prisma } from "~/lib/db";
import { isAdmin, currentTerm } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_DOMAIN_LEAD_TOOL = {
  name: "manage_domain_lead",
  description:
    "Add or remove a domain lead assignment. Add always targets the current active term. " +
    "Only admins may call this tool.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove"],
        description: "The operation to perform.",
      },
      domainId: {
        type: "string",
        description: "Required for add — the id of the domain.",
      },
      userId: {
        type: "string",
        description: "Required for add — the userId to assign as lead.",
      },
      assignmentId: {
        type: "string",
        description: "Required for remove — the id of the DomainLeadAssignment row.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  action: string;
  domainId?: string;
  userId?: string;
  assignmentId?: string;
};

export async function runManageDomainLead(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;
  const { request } = ctx;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can manage domain lead assignments.");
  }

  requireForAction(args.action, args as Record<string, unknown>, {
    add: ["domainId", "userId"],
    remove: ["assignmentId"],
  });

  if (args.action === "add") {
    const { domainId, userId } = args as Required<Pick<Input, "domainId" | "userId">>;

    const term = await currentTerm();
    if (!term) throw new McpInvalidError("No current Term — cannot add a domain lead without an active term.");

    const assignment = await prisma.domainLeadAssignment.create({
      data: { userId, domainId, termId: term.id },
      include: { user: true, domain: true, term: true },
    });

    await logAuditEvent({
      action: "domain.lead.add",
      userId: callerId,
      targetId: userId,
      metadata: { domainId, assignmentId: assignment.id, termId: term.id },
      request,
    });

    return assignment;
  }

  // action === "remove"
  const { assignmentId } = args as Required<Pick<Input, "assignmentId">>;

  const removed = await prisma.domainLeadAssignment.delete({
    where: { id: assignmentId },
  });

  await logAuditEvent({
    action: "domain.lead.remove",
    userId: callerId,
    targetId: removed.userId,
    metadata: { domainId: removed.domainId, assignmentId, termId: removed.termId },
    request,
  });

  return { ok: true };
}
