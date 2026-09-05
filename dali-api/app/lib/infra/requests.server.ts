// InfraRequest queue: staffed members (and Core) submit change requests from a
// project's Infrastructure section; Core/Admin fulfill/reject from the fleet
// console. v1 fulfills manually — Core performs the change via the console
// actions, then marks the request resolved. userIds are free-form (AuditLog
// style), so names are resolved with a follow-up query.

import { prisma } from "~/lib/db";
import type { InfraRequestKind, InfraRequestStatus } from "~/generated/prisma/client";

export type PendingInfraRequest = {
  id: string;
  projectId: string;
  projectName: string;
  kind: InfraRequestKind;
  details: string;
  targetHint: string | null;
  requestedByName: string;
  createdAt: string;
};

export async function listPendingInfraRequests(): Promise<PendingInfraRequest[]> {
  const rows = await prisma.infraRequest.findMany({
    where: { status: "Pending" },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const userIds = [...new Set(rows.map((r) => r.requestedByUserId))];
  const [projects, users] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  const userName = new Map(
    users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || "Unknown"]),
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: projName.get(r.projectId) ?? r.projectId,
    kind: r.kind,
    details: r.details,
    targetHint: r.targetHint,
    requestedByName: userName.get(r.requestedByUserId) ?? "Unknown",
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ProjectInfraRequest = {
  id: string;
  kind: InfraRequestKind;
  details: string;
  targetHint: string | null;
  status: InfraRequestStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

// Recent requests for one project (the project hub's Infrastructure section).
export async function listProjectInfraRequests(
  projectId: string,
  limit = 20,
): Promise<ProjectInfraRequest[]> {
  const rows = await prisma.infraRequest.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    details: r.details,
    targetHint: r.targetHint,
    status: r.status,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

export async function createInfraRequest(input: {
  projectId: string;
  requestedByUserId: string;
  kind: InfraRequestKind;
  details: string;
  targetHint?: string | null;
}): Promise<string> {
  const r = await prisma.infraRequest.create({
    data: {
      projectId: input.projectId,
      requestedByUserId: input.requestedByUserId,
      kind: input.kind,
      details: input.details,
      targetHint: input.targetHint ?? null,
    },
    select: { id: true },
  });
  return r.id;
}

export async function resolveInfraRequest(input: {
  requestId: string;
  resolvedByUserId: string;
  status: "Fulfilled" | "Rejected";
  note?: string | null;
}): Promise<void> {
  await prisma.infraRequest.update({
    where: { id: input.requestId },
    data: {
      status: input.status,
      resolvedByUserId: input.resolvedByUserId,
      resolutionNote: input.note ?? null,
      resolvedAt: new Date(),
    },
  });
}
