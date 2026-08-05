// MCP tool: manage_partner_project_link — link, end, or unlink partner-project relationships.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   link   — create a ProjectPartner link (orgId + projectId required).
//   end    — set endedAt = now on a ProjectPartner (projectPartnerId required).
//   unlink — permanently delete a ProjectPartner (projectPartnerId required).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  linkProjectPartner,
  updateProjectPartnerDates,
  unlinkProjectPartner,
} from "~/partners/lib/partner-access";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_PROJECT_LINK_TOOL = {
  name: "manage_partner_project_link",
  description:
    "Link, end, or unlink a partner-to-project relationship. Action 'link' creates a new ProjectPartner link (orgId + projectId required). Action 'end' sets the endedAt date to now, ending the active window (projectPartnerId required). Action 'unlink' permanently removes the link (projectPartnerId required). Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["link", "end", "unlink"],
        description: "What to do.",
      },
      orgId: { type: "string", description: "Required for link (PartnerOrg.id)." },
      projectId: { type: "string", description: "Required for link." },
      projectPartnerId: {
        type: "string",
        description: "Required for end and unlink (ProjectPartner.id).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerProjectLink(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner project links");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    link: ["orgId", "projectId"],
    end: ["projectPartnerId"],
    unlink: ["projectPartnerId"],
  });

  // ── link ──────────────────────────────────────────────────────────────────
  if (action === "link") {
    const result = await linkProjectPartner(
      { projectId: input.projectId as string, partnerOrgId: input.orgId as string },
      { actorUserId: callerId },
    );
    if ("error" in result) throw new McpInvalidError(result.error);
    return { id: result.id };
  }

  // ── end ───────────────────────────────────────────────────────────────────
  if (action === "end") {
    const projectPartnerId = input.projectPartnerId as string;
    const existing = await prisma.projectPartner.findUnique({
      where: { id: projectPartnerId },
      select: { id: true, startedAt: true },
    });
    if (!existing) throw new McpNotFoundError(`ProjectPartner ${projectPartnerId} not found`);

    const result = await updateProjectPartnerDates(
      {
        projectPartnerId,
        startedAt: existing.startedAt,
        endedAt: new Date(),
      },
      { actorUserId: callerId },
    );
    if ("error" in result) throw new McpInvalidError(result.error);
    return { ok: true };
  }

  // ── unlink ────────────────────────────────────────────────────────────────
  const projectPartnerId = input.projectPartnerId as string;
  const existing = await prisma.projectPartner.findUnique({
    where: { id: projectPartnerId },
    select: { id: true },
  });
  if (!existing) throw new McpNotFoundError(`ProjectPartner ${projectPartnerId} not found`);

  const result = await unlinkProjectPartner(projectPartnerId, { actorUserId: callerId });
  if ("error" in result) throw new McpInvalidError(result.error);
  return { ok: true };
}
