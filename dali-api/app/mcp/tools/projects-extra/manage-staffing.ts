import { prisma } from "~/lib/db.server";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import type { Level } from "~/generated/prisma/client";
import type { McpCtx } from "../../registry";
import { LEVELS, runSetDomainEligibility, runSetStaffingAssignment } from "../staffing";
import { McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction } from "./errors";
import { publishCycleChange } from "~/projects/lib/staffing-events.server";

async function requireStaffingManager(callerId: string) {
  if (!(await canManageStaffing(callerId))) {
    throw new McpForbiddenError("Only staffing managers can modify the staffing board.");
  }
}

export const MANAGE_STAFFING_TOOL = {
  name: "manage_staffing",
  description:
    "Manage staffing. Actions: assign (propose a member's placement on a project; Proposed rows only, Confirmed/Declined stay as the audit trail), set_eligibility (a member's level ceiling in a domain), set_mentor_role (mark a user as mentor/non-mentor), add_external_mentor / remove_external_mentor (external mentor entries on a project), add_board_member / remove_board_member (who appears on the board). Staffing managers only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "assign",
          "set_eligibility",
          "set_mentor_role",
          "add_external_mentor",
          "remove_external_mentor",
          "add_board_member",
          "remove_board_member",
        ],
      },
      cycleId: { type: "string", minLength: 1, description: "StaffingCycle.id. Every action except set_eligibility." },
      userId: { type: "string", minLength: 1, description: "User.id. Every action except remove_external_mentor." },
      isMentor: { type: "boolean", description: "For set_mentor_role: true to mark as mentor, false to override as non-mentor." },
      projectId: {
        type: ["string", "null"],
        description:
          "assign: project to staff them on (keeps their other projects), or null to remove them. add_external_mentor: Project.id.",
      },
      fromProjectId: {
        type: "string",
        description:
          "assign: the source project to also clear when moving; with projectId null, the one project to remove them from (omit to clear all Proposed rows).",
      },
      domains: {
        type: "array",
        description: "assign: one entry per domain they'll work in on the project. Required unless projectId is null.",
        items: {
          type: "object",
          properties: {
            domainId: { type: "string" },
            level: { type: "string", enum: [...LEVELS] },
          },
          required: ["domainId", "level"],
          additionalProperties: false,
        },
      },
      domainId: { type: "string", minLength: 1, description: "Domain.id. add_external_mentor, set_eligibility." },
      level: { type: "string", enum: [...LEVELS], description: "set_eligibility: P1 learner, P2 doer, P3 mentor." },
      externalMentorId: { type: "string", minLength: 1, description: "ExternalMentor.id (for remove_external_mentor)." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageStaffingInput = {
  action: string;
  cycleId?: string;
  userId?: string;
  isMentor?: boolean;
  projectId?: string | null;
  fromProjectId?: string;
  domains?: { domainId: string; level: Level }[];
  level?: Level;
  domainId?: string;
  externalMentorId?: string;
};

export async function runManageStaffing(
  callerId: string,
  input: ManageStaffingInput,
  ctx?: Pick<McpCtx, "request">,
): Promise<{ ok: true; id?: string } | { ok: true; proposed: number; clearedProposed: number } | { ok: true; created: boolean }> {
  requireForAction(input.action, input, {
    assign: ["cycleId", "userId"],
    set_eligibility: ["userId", "domainId", "level"],
    set_mentor_role: ["cycleId", "userId", "isMentor"],
    add_external_mentor: ["cycleId", "projectId", "domainId", "userId"],
    remove_external_mentor: ["cycleId", "externalMentorId"],
    add_board_member: ["cycleId", "userId"],
    remove_board_member: ["cycleId", "userId"],
  });

  if (input.action === "assign") {
    if (input.projectId === undefined) {
      throw new McpInvalidError("action 'assign' requires: projectId (null to unassign)");
    }
    return runSetStaffingAssignment(
      callerId,
      {
        cycleId: input.cycleId!,
        userId: input.userId!,
        projectId: input.projectId,
        fromProjectId: input.fromProjectId,
        domains: input.domains,
      },
      ctx,
    );
  }
  if (input.action === "set_eligibility") {
    return runSetDomainEligibility(
      callerId,
      { userId: input.userId!, domainId: input.domainId!, level: input.level! },
      ctx,
    );
  }

  await requireStaffingManager(callerId);

  const cycleId = input.cycleId!;
  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true },
  });
  if (!cycle) throw new McpNotFoundError("Staffing cycle not found.");

  // ── set_mentor_role ──────────────────────────────────────────────────────────
  if (input.action === "set_mentor_role") {
    await prisma.staffingMentorRole.upsert({
      where: { staffingCycleId_userId: { staffingCycleId: cycleId, userId: input.userId! } },
      update: { isMentor: input.isMentor! },
      create: {
        staffingCycleId: cycleId,
        userId: input.userId!,
        isMentor: input.isMentor!,
        createdById: callerId,
      },
    });
    // Mirror api.staffing.mentor-role.ts — the board write is audit-logged.
    await logAuditEvent({
      action: "staffing.mentorRole.set",
      userId: callerId,
      targetId: input.userId!,
      metadata: { cycleId: cycleId, isMentor: input.isMentor! },
    });
    await publishCycleChange(cycleId);
    return { ok: true };
  }

  // ── add_external_mentor ──────────────────────────────────────────────────────
  if (input.action === "add_external_mentor") {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId! },
      select: { id: true },
    });
    if (!project) throw new McpNotFoundError("Project not found.");

    const domain = await prisma.domain.findUnique({
      where: { id: input.domainId! },
      select: { id: true },
    });
    if (!domain) throw new McpNotFoundError("Domain not found.");

    const em = await prisma.externalMentor.upsert({
      where: {
        staffingCycleId_projectId_userId_domainId: {
          staffingCycleId: cycleId,
          projectId: input.projectId!,
          userId: input.userId!,
          domainId: input.domainId!,
        },
      },
      update: {},
      create: {
        staffingCycleId: cycleId,
        projectId: input.projectId!,
        domainId: input.domainId!,
        userId: input.userId!,
      },
    });
    await publishCycleChange(cycleId);
    return { ok: true, id: em.id };
  }

  // ── remove_external_mentor ───────────────────────────────────────────────────
  if (input.action === "remove_external_mentor") {
    const em = await prisma.externalMentor.findUnique({
      where: { id: input.externalMentorId! },
      select: { id: true },
    });
    if (!em) throw new McpNotFoundError("External mentor entry not found.");
    await prisma.externalMentor.delete({ where: { id: em.id } });
    await publishCycleChange(cycleId);
    return { ok: true };
  }

  // ── add_board_member ─────────────────────────────────────────────────────────
  if (input.action === "add_board_member") {
    // Must be a real DALI member — mirrors api.staffing.board-member.ts. The
    // board is the staff-able pool, so a non-member user id can't be placed.
    const user = await prisma.user.findFirst({
      where: { id: input.userId!, daliMember: { isNot: null } },
      select: { id: true },
    });
    if (!user) throw new McpInvalidError("User is not a DALI member.");
    await prisma.staffingBoardMember.upsert({
      where: { userId_staffingCycleId: { userId: input.userId!, staffingCycleId: cycleId } },
      update: {},
      create: { userId: input.userId!, staffingCycleId: cycleId, addedById: callerId },
    });
    await publishCycleChange(cycleId);
    return { ok: true };
  }

  // ── remove_board_member ──────────────────────────────────────────────────────
  // (action === "remove_board_member")
  await prisma.staffingBoardMember.deleteMany({
    where: { userId: input.userId!, staffingCycleId: cycleId },
  });
  await publishCycleChange(cycleId);
  return { ok: true };
}
