import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import type { Level } from "~/lib/level";
import { addOrUpdateEligibility } from "~/admin/lib/eligibility.server";
import { publishCycleChange } from "./staffing-events.server";
import { dedupeLiveAssignments } from "./staffing-board";

export class StaffingWriteError extends Error {
  constructor(
    message: string,
    public status: 400 | 404,
  ) {
    super(message);
    this.name = "StaffingWriteError";
  }
}

export type DomainLevel = { domainId: string; level: Level };

export async function assignStaffing(a: {
  cycleId: string;
  userId: string;
  projectId: string | null;
  fromProjectId?: string;
  domains: DomainLevel[];
  actorId: string;
  request?: Request;
}): Promise<{ proposed: number; clearedProposed: number }> {
  const { cycleId, userId, projectId, fromProjectId, domains, actorId } = a;
  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, termId: true },
  });
  if (!cycle) throw new StaffingWriteError("Cycle not found", 404);

  if (projectId !== null) {
    if (domains.length === 0) {
      throw new StaffingWriteError(
        "domains is required when assigning to a project, pass at least one { domainId, level }",
        400,
      );
    }
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new StaffingWriteError("Project not found", 404);
    const found = await prisma.domain.count({
      where: { id: { in: domains.map((d) => d.domainId) } },
    });
    if (found !== new Set(domains.map((d) => d.domainId)).size) {
      throw new StaffingWriteError("One or more domainIds do not exist", 400);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    if (projectId === null && !fromProjectId) {
      const cleared = await tx.staffingAssignment.deleteMany({
        where: { userId, staffingCycleId: cycleId, status: "Proposed" },
      });
      return { proposed: 0, clearedProposed: cleared.count };
    }

    const projectsToClear = new Set<string>();
    if (projectId !== null) projectsToClear.add(projectId);
    if (fromProjectId) projectsToClear.add(fromProjectId);

    const cleared = await tx.staffingAssignment.deleteMany({
      where: {
        userId,
        staffingCycleId: cycleId,
        projectId: { in: [...projectsToClear] },
        status: "Proposed",
      },
    });

    // finalize's drop-detector only sees Confirmed rows, so the roster row must go here.
    if (fromProjectId) {
      await tx.staffingAssignment.updateMany({
        where: { userId, staffingCycleId: cycleId, projectId: fromProjectId, status: "Confirmed" },
        data: { status: "Declined" },
      });
      await tx.projectAssignment.deleteMany({
        where: { userId, projectId: fromProjectId, termId: cycle.termId },
      });
    }

    let proposed = 0;
    if (projectId !== null) {
      for (const d of domains) {
        await tx.staffingAssignment.create({
          data: {
            userId,
            staffingCycleId: cycleId,
            projectId,
            termId: cycle.termId,
            domainId: d.domainId,
            level: d.level,
            status: "Proposed",
            assignedById: actorId,
          },
        });
        proposed++;
      }
    }
    return { proposed, clearedProposed: cleared.count };
  });

  await logAuditEvent({
    action: "staffing.assign",
    userId: actorId,
    targetId: userId,
    metadata: {
      cycleId,
      projectId,
      fromProjectId: fromProjectId ?? null,
      domains: projectId === null ? null : domains.map((d) => ({ domainId: d.domainId, level: d.level })),
      domainId: domains[0]?.domainId ?? null,
      level: domains[0]?.level ?? null,
    },
    request: a.request,
  });
  publishCycleChange(cycleId);
  return result;
}

export async function setDomainEligibility(a: {
  userId: string;
  domainId: string;
  level: Level;
  actorId: string;
  cycleId?: string;
  request?: Request;
}): Promise<{ created: boolean; domainName: string }> {
  const { userId, domainId, level, actorId, cycleId } = a;
  const [cycle, domain, user] = await Promise.all([
    cycleId
      ? prisma.staffingCycle.findUnique({
          where: { id: cycleId },
          select: { id: true, termId: true },
        })
      : Promise.resolve(null),
    prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, name: true, displayName: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (cycleId && !cycle) throw new StaffingWriteError("Cycle not found", 404);
  if (!domain) throw new StaffingWriteError("Domain not found", 404);
  if (!user) throw new StaffingWriteError("User not found", 404);

  const existing = await prisma.domainEligibility.findFirst({
    where: { userId, domainId },
    select: { id: true },
  });
  await addOrUpdateEligibility({ userId, domainId, level, actorId });

  if (cycle) await syncLiveAssignments({ cycle, userId, domainId, level, actorId });

  await logAuditEvent({
    action: "staffing.eligibility.set",
    userId: actorId,
    targetId: userId,
    metadata: { cycleId: cycleId ?? null, domainId, level },
    request: a.request,
  });
  if (cycle) publishCycleChange(cycle.id);

  return { created: !existing, domainName: domain.displayName || domain.name };
}

async function syncLiveAssignments(a: {
  cycle: { id: string; termId: string };
  userId: string;
  domainId: string;
  level: Level;
  actorId: string;
}) {
  const { cycle, userId, domainId, level, actorId } = a;
  const cycleRows = await prisma.staffingAssignment.findMany({
    where: { staffingCycleId: cycle.id, userId, status: { in: ["Proposed", "Confirmed"] } },
    select: { id: true, userId: true, projectId: true, domainId: true, level: true, status: true },
  });
  const liveRows = dedupeLiveAssignments(cycleRows);
  const affectedProjectIds = [
    ...new Set(liveRows.filter((r) => r.domainId === domainId && r.level !== level).map((r) => r.projectId)),
  ];
  if (affectedProjectIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const projectId of affectedProjectIds) {
      const siblings = liveRows.filter((r) => r.projectId === projectId);
      await tx.staffingAssignment.deleteMany({
        where: { userId, staffingCycleId: cycle.id, projectId, status: "Proposed" },
      });
      for (const r of siblings) {
        await tx.staffingAssignment.create({
          data: {
            userId,
            staffingCycleId: cycle.id,
            projectId,
            termId: cycle.termId,
            domainId: r.domainId,
            level: r.domainId === domainId ? level : r.level,
            status: "Proposed",
            assignedById: actorId,
          },
        });
      }
    }
  });
}
