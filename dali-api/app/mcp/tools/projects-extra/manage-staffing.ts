// MCP `manage_staffing` — faceted tool for staffing-board metadata that lives
// outside the core proposal/finalize flow.
//
// Actions:
//   set_mentor_role     — upsert a StaffingMentorRole override (mark a user as
//                         mentor/non-mentor for the cycle).
//   add_external_mentor — add an ExternalMentor to a project for a cycle.
//   remove_external_mentor — remove an ExternalMentor by id.
//   add_board_member    — add a user to the staffing board for a cycle.
//   remove_board_member — remove a user from the staffing board for a cycle.
//
// All actions mirror the routes under api.staffing.*.ts and share the same
// canManageStaffing gate. After each write the cycle SSE channel is pulsed
// via publishCycleChange().

import { prisma } from "~/lib/db";
import { canManageStaffing } from "~/lib/roles";
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
    "Manage staffing-board metadata. Actions: set_mentor_role (mark a user as mentor/non-mentor), add_external_mentor / remove_external_mentor (external mentor entries on a project), add_board_member / remove_board_member (who appears on the board). Staffing managers only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "set_mentor_role",
          "add_external_mentor",
          "remove_external_mentor",
          "add_board_member",
          "remove_board_member",
        ],
      },
      cycleId: { type: "string", minLength: 1, description: "StaffingCycle.id." },
      userId: { type: "string", minLength: 1, description: "User.id (for set_mentor_role, add/remove_board_member)." },
      isMentor: { type: "boolean", description: "For set_mentor_role: true to mark as mentor, false to override as non-mentor." },
      projectId: { type: "string", minLength: 1, description: "Project.id (for add/remove_external_mentor)." },
      domainId: { type: "string", minLength: 1, description: "Domain.id (for add_external_mentor)." },
      externalMentorId: { type: "string", minLength: 1, description: "ExternalMentor.id (for remove_external_mentor)." },
    },
    required: ["action", "cycleId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageStaffingInput = {
  action: string;
  cycleId: string;
  userId?: string;
  isMentor?: boolean;
  projectId?: string;
  domainId?: string;
  externalMentorId?: string;
};

export async function runManageStaffing(
  callerId: string,
  input: ManageStaffingInput,
): Promise<{ ok: true; id?: string }> {
  requireForAction(input.action, input, {
    set_mentor_role: ["cycleId", "userId", "isMentor"],
    add_external_mentor: ["cycleId", "projectId", "domainId", "userId"],
    remove_external_mentor: ["cycleId", "externalMentorId"],
    add_board_member: ["cycleId", "userId"],
    remove_board_member: ["cycleId", "userId"],
  });

  await requireStaffingManager(callerId);

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: input.cycleId },
    select: { id: true },
  });
  if (!cycle) throw new McpNotFoundError("Staffing cycle not found.");

  // ── set_mentor_role ──────────────────────────────────────────────────────────
  if (input.action === "set_mentor_role") {
    await prisma.staffingMentorRole.upsert({
      where: { staffingCycleId_userId: { staffingCycleId: input.cycleId, userId: input.userId! } },
      update: { isMentor: input.isMentor! },
      create: { staffingCycleId: input.cycleId, userId: input.userId!, isMentor: input.isMentor! },
    });
    await publishCycleChange(input.cycleId);
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
          staffingCycleId: input.cycleId,
          projectId: input.projectId!,
          userId: input.userId!,
          domainId: input.domainId!,
        },
      },
      update: {},
      create: {
        staffingCycleId: input.cycleId,
        projectId: input.projectId!,
        domainId: input.domainId!,
        userId: input.userId!,
      },
    });
    await publishCycleChange(input.cycleId);
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
    await publishCycleChange(input.cycleId);
    return { ok: true };
  }

  // ── add_board_member ─────────────────────────────────────────────────────────
  if (input.action === "add_board_member") {
    const user = await prisma.user.findUnique({
      where: { id: input.userId! },
      select: { id: true },
    });
    if (!user) throw new McpNotFoundError("User not found.");
    await prisma.staffingBoardMember.upsert({
      where: { userId_staffingCycleId: { userId: input.userId!, staffingCycleId: input.cycleId } },
      update: {},
      create: { userId: input.userId!, staffingCycleId: input.cycleId },
    });
    await publishCycleChange(input.cycleId);
    return { ok: true };
  }

  // ── remove_board_member ──────────────────────────────────────────────────────
  // (action === "remove_board_member")
  await prisma.staffingBoardMember.deleteMany({
    where: { userId: input.userId!, staffingCycleId: input.cycleId },
  });
  await publishCycleChange(input.cycleId);
  return { ok: true };
}
