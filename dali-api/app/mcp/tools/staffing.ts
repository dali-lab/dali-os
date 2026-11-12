// MCP staffing tools — read the staffing board for a cycle, propose and clear
// assignments, and set domain eligibility.
//
// All of it is gated on canManageStaffing, the same check the board's own API
// routes use, so an ordinary member's agent can't reshuffle staffing.
//
// DELIBERATELY NOT EXPOSED: `finalize` and `sync-teams`. Those provision real
// things outside DALI OS — Google Workspace accounts, GitHub org teams, Slack
// channels, and announcement posts — and several of the effects can't be undone
// from this app. They stay on the board, where a human is looking at what
// they're about to trigger. `reorder` is column display order (nothing an agent
// needs) and `events` is an SSE stream (not expressible as a tool).
//
// Assignments are written as Proposed, exactly as the board writes them.
// Confirmed and Declined rows are staffing's audit trail and are never touched.

import { prisma } from "~/lib/db.server";
import { canManageStaffing } from "~/lib/roles";
import { fullName } from "~/lib/display";
import type { Level } from "~/generated/prisma/client";
import type { McpCtx } from "../registry";
import { assignStaffing, setDomainEligibility, StaffingWriteError } from "~/projects/lib/staffing-assign.server";

const LEVELS = ["P1", "P2", "P3"] as const;

export class StaffingForbiddenError extends Error {
  status = 403;
  constructor() {
    super("Only staffing managers can read or change the staffing board");
    this.name = "StaffingForbiddenError";
  }
}

export class StaffingNotFoundError extends Error {
  status = 404;
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "StaffingNotFoundError";
  }
}

export class StaffingInvalidError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "StaffingInvalidError";
  }
}

async function requireStaffingManager(callerId: string): Promise<void> {
  if (!(await canManageStaffing(callerId))) throw new StaffingForbiddenError();
}

// ─── get_staffing_board ──────────────────────────────────────────────────────

export const GET_STAFFING_BOARD_TOOL = {
  name: "get_staffing_board",
  description:
    "Read a staffing cycle's board: every proposed and confirmed assignment grouped by project, plus the members who bid into the cycle but aren't placed yet. Staffing managers only. Omit cycleId to get the most recent cycle. The board is not paged. Pass projectId to read one project's column only, which leaves out the unassigned column.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: {
        type: "string",
        description: "StaffingCycle.id. Defaults to the latest term's cycle.",
      },
      projectId: {
        type: "string",
        minLength: 1,
        description: "Return only this project's column.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type StaffingBoardOut = {
  cycle: { id: string; name: string; termCode: string | null };
  columns: {
    projectId: string | null;
    projectName: string;
    members: {
      userId: string;
      name: string;
      domain: string;
      level: Level;
      status: string;
    }[];
  }[];
};

export async function runGetStaffingBoard(
  callerId: string,
  input: { cycleId?: string; projectId?: string } = {},
): Promise<StaffingBoardOut> {
  await requireStaffingManager(callerId);

  // One cycle per term (termId is unique), so "most recent" means the latest
  // term by sortKey rather than a createdAt the model doesn't have.
  const cycle = input.cycleId
    ? await prisma.staffingCycle.findUnique({
        where: { id: input.cycleId },
        select: { id: true, name: true, term: { select: { code: true } } },
      })
    : await prisma.staffingCycle.findFirst({
        orderBy: { term: { sortKey: "desc" } },
        select: { id: true, name: true, term: { select: { code: true } } },
      });
  if (!cycle) throw new StaffingNotFoundError(input.cycleId ? "Staffing cycle" : "Any staffing cycle");

  const [assignments, boardMembers] = await Promise.all([
    // StaffingAssignment declares relations only to user, cycle and term —
    // projectId and domainId carry no FK relation, so their names are looked
    // up separately below rather than joined.
    prisma.staffingAssignment.findMany({
      // Declined rows are audit trail only (a member removed from a project) —
      // exclude them so a dropped placement doesn't linger as a ghost column.
      where: {
        staffingCycleId: cycle.id,
        status: { not: "Declined" },
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      select: {
        userId: true,
        projectId: true,
        domainId: true,
        level: true,
        status: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    // Everyone on the board for this cycle; those without an assignment are
    // the "unassigned" column the board shows on the left.
    input.projectId
      ? Promise.resolve([])
      : prisma.staffingBoardMember.findMany({
          where: { staffingCycleId: cycle.id },
          select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        }),
  ]);

  const [projectRows, domainRows] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: [...new Set(assignments.map((a) => a.projectId))] } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: [...new Set(assignments.map((a) => a.domainId))] } },
      select: { id: true, displayName: true },
    }),
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const domainName = new Map(domainRows.map((d) => [d.id, d.displayName]));

  const byProject = new Map<string, StaffingBoardOut["columns"][number]>();
  for (const a of assignments) {
    let col = byProject.get(a.projectId);
    if (!col) {
      col = {
        projectId: a.projectId,
        projectName: projectName.get(a.projectId) ?? "(deleted project)",
        members: [],
      };
      byProject.set(a.projectId, col);
    }
    col.members.push({
      userId: a.userId,
      name: fullName(a.user),
      domain: domainName.get(a.domainId) ?? "—",
      level: a.level,
      status: a.status,
    });
  }

  const placed = new Set(assignments.map((a) => a.userId));
  const unassigned = boardMembers
    .filter((m) => !placed.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: fullName(m.user),
      domain: "—",
      level: "P1" as Level,
      status: "Unassigned",
    }));

  const columns = [...byProject.values()].sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
  if (unassigned.length) {
    columns.unshift({ projectId: null, projectName: "Unassigned", members: unassigned });
  }

  return {
    cycle: { id: cycle.id, name: cycle.name, termCode: cycle.term?.code ?? null },
    columns,
  };
}

// ─── set_staffing_assignment ─────────────────────────────────────────────────

export const SET_STAFFING_ASSIGNMENT_TOOL = {
  name: "set_staffing_assignment",
  description:
    "Propose a member's staffing on a project for a cycle. A member can be staffed on multiple projects at once, so this only replaces their Proposed rows ON THAT project — other projects are untouched. Pass projectId: null with fromProjectId to remove them from just that project, or projectId: null with no fromProjectId to clear all their Proposed rows (full unassign). Confirmed/Declined rows are left as the audit trail (removing from a finalized project Declines its Confirmed rows). Staffing managers only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: { type: "string", minLength: 1, description: "StaffingCycle.id." },
      userId: { type: "string", minLength: 1, description: "The member being staffed." },
      projectId: {
        type: ["string", "null"],
        description:
          "Project to staff them on (additive — keeps their other projects), or null to remove/unassign.",
      },
      fromProjectId: {
        type: "string",
        description:
          "When moving between projects, the source project to also clear. With projectId: null, the single project to remove them from.",
      },
      domains: {
        type: "array",
        description:
          "One entry per domain they'll work in on this project. Required unless projectId is null.",
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
    },
    required: ["cycleId", "userId", "projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type AssignInput = {
  cycleId: string;
  userId: string;
  projectId: string | null;
  fromProjectId?: string;
  domains?: { domainId: string; level: Level }[];
};

function asMcpError(err: unknown): never {
  if (err instanceof StaffingWriteError) {
    if (err.status === 404) throw new StaffingNotFoundError(err.message.replace(/ not found$/, ""));
    throw new StaffingInvalidError(err.message);
  }
  throw err;
}

export async function runSetStaffingAssignment(
  callerId: string,
  input: AssignInput,
  ctx?: Pick<McpCtx, "request">,
): Promise<{ ok: true; proposed: number; clearedProposed: number }> {
  await requireStaffingManager(callerId);
  try {
    const result = await assignStaffing({
      cycleId: input.cycleId,
      userId: input.userId,
      projectId: input.projectId,
      fromProjectId: input.fromProjectId,
      domains: input.domains ?? [],
      actorId: callerId,
      request: ctx?.request,
    });
    return { ok: true, ...result };
  } catch (err) {
    return asMcpError(err);
  }
}

// ─── set_domain_eligibility ──────────────────────────────────────────────────

export const SET_DOMAIN_ELIGIBILITY_TOOL = {
  name: "set_domain_eligibility",
  description:
    "Set a member's eligibility level in a domain — the ceiling on what they can be staffed at. Staffing managers only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userId: { type: "string", minLength: 1 },
      domainId: { type: "string", minLength: 1 },
      level: {
        type: "string",
        enum: [...LEVELS],
        description: "P1 learner, P2 doer, P3 mentor.",
      },
    },
    required: ["userId", "domainId", "level"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runSetDomainEligibility(
  callerId: string,
  input: { userId: string; domainId: string; level: Level },
  ctx?: Pick<McpCtx, "request">,
): Promise<{ ok: true; created: boolean }> {
  await requireStaffingManager(callerId);
  try {
    const { created } = await setDomainEligibility({
      userId: input.userId,
      domainId: input.domainId,
      level: input.level,
      actorId: callerId,
      request: ctx?.request,
    });
    return { ok: true, created };
  } catch (err) {
    return asMcpError(err);
  }
}
