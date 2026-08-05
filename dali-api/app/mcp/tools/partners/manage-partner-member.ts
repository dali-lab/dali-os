// MCP tool: manage_partner_member — invite, revoke, update, move, or remove partner members.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   invite        — send an invite to email for orgId.
//   revoke_invite — revoke a pending invite by inviteId within orgId.
//   set_role      — update the displayRole label for a PartnerUser.
//   move          — move a PartnerUser to a different org (targetOrgId).
//   remove        — remove a PartnerUser from their org.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  createPartnerInvite,
  revokePartnerInvite,
} from "~/partners/lib/invites.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_MEMBER_TOOL = {
  name: "manage_partner_member",
  description:
    "Manage partner organization members. Action 'invite' sends an email invite. Action 'revoke_invite' cancels a pending invite. Action 'set_role' updates the display role label. Action 'move' moves a member to a different org. Action 'remove' removes a member. Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["invite", "revoke_invite", "set_role", "move", "remove"],
        description: "What to do.",
      },
      orgId: { type: "string", description: "Partner org id." },
      partnerUserId: {
        type: "string",
        description: "Required for set_role, move, and remove (PartnerUser.id).",
      },
      inviteId: {
        type: "string",
        description: "Required for revoke_invite (PartnerInvite.id).",
      },
      email: { type: "string", description: "Required for invite." },
      displayRole: { type: "string", description: "Optional display role label." },
      targetOrgId: {
        type: "string",
        description: "Required for move: destination org id.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerMember(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner organization members");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    invite: ["orgId", "email"],
    revoke_invite: ["orgId", "inviteId"],
    set_role: ["orgId", "partnerUserId"],
    move: ["orgId", "partnerUserId", "targetOrgId"],
    remove: ["orgId", "partnerUserId"],
  });

  const orgId = input.orgId as string;

  // ── invite ────────────────────────────────────────────────────────────────
  if (action === "invite") {
    const result = await createPartnerInvite({
      partnerOrgId: orgId,
      email: input.email as string,
      displayRole: (input.displayRole as string | undefined) || null,
      invitedByUserId: callerId,
    });
    if ("error" in result) throw new McpInvalidError(result.error);
    return { ok: true };
  }

  // ── revoke_invite ─────────────────────────────────────────────────────────
  if (action === "revoke_invite") {
    const result = await revokePartnerInvite({
      inviteId: input.inviteId as string,
      partnerOrgId: orgId,
      actorUserId: callerId,
    });
    if ("error" in result) throw new McpInvalidError(result.error);
    return { ok: true };
  }

  // ── set_role ──────────────────────────────────────────────────────────────
  if (action === "set_role") {
    const partnerUserId = input.partnerUserId as string;
    const displayRole = (input.displayRole as string | undefined)?.trim() || null;
    const res = await prisma.partnerUser.updateMany({
      where: { id: partnerUserId, partnerOrgId: orgId },
      data: { displayRole },
    });
    if (res.count !== 1) throw new McpNotFoundError("Member not found in this organization");
    await logAuditEvent({
      action: "partner.member.update",
      userId: callerId,
      targetId: partnerUserId,
      metadata: { partnerOrgId: orgId },
    });
    return { ok: true };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action === "move") {
    const partnerUserId = input.partnerUserId as string;
    const targetOrgId = input.targetOrgId as string;
    if (targetOrgId === orgId) {
      throw new McpInvalidError("That member is already in this organization");
    }

    const [member, org, target] = await Promise.all([
      prisma.partnerUser.findFirst({
        where: { id: partnerUserId, partnerOrgId: orgId },
        select: { id: true },
      }),
      prisma.partnerOrg.findUnique({
        where: { id: orgId },
        select: { id: true, primaryContactId: true },
      }),
      prisma.partnerOrg.findUnique({
        where: { id: targetOrgId },
        select: { id: true },
      }),
    ]);

    if (!member) throw new McpNotFoundError("Member not found in this organization");
    if (!org) throw new McpNotFoundError(`Partner organization ${orgId} not found`);
    if (!target) throw new McpNotFoundError(`Target organization ${targetOrgId} not found`);

    await prisma.$transaction(async (tx) => {
      // Primary contact doesn't travel — the source org loses it.
      if (org.primaryContactId === partnerUserId) {
        await tx.partnerOrg.update({
          where: { id: orgId },
          data: { primaryContactId: null },
        });
      }
      await tx.partnerUser.update({
        where: { id: partnerUserId },
        data: { partnerOrgId: targetOrgId },
      });
    });
    await logAuditEvent({
      action: "partner.member.update",
      userId: callerId,
      targetId: partnerUserId,
      metadata: { movedFrom: orgId, movedTo: targetOrgId },
    });
    return { ok: true };
  }

  // ── remove ────────────────────────────────────────────────────────────────
  const partnerUserId = input.partnerUserId as string;
  const [member, org] = await Promise.all([
    prisma.partnerUser.findFirst({
      where: { id: partnerUserId, partnerOrgId: orgId },
      select: { id: true },
    }),
    prisma.partnerOrg.findUnique({
      where: { id: orgId },
      select: { id: true, primaryContactId: true },
    }),
  ]);

  if (!member) throw new McpNotFoundError("Member not found in this organization");
  if (!org) throw new McpNotFoundError(`Partner organization ${orgId} not found`);

  await prisma.$transaction(async (tx) => {
    if (org.primaryContactId === partnerUserId) {
      await tx.partnerOrg.update({
        where: { id: orgId },
        data: { primaryContactId: null },
      });
    }
    await tx.partnerUser.delete({ where: { id: partnerUserId } });
  });
  await logAuditEvent({
    action: "partner.member.update",
    userId: callerId,
    targetId: partnerUserId,
    metadata: { removedFrom: orgId },
  });
  return { ok: true };
}
