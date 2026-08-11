import type { Route } from "./+types/api.staffing.assign";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { isLevel, type Level } from "~/lib/level";
import { publishCycleChange } from "../lib/staffing-events.server";

// POST /api/staffing/assign
//
// A member can be staffed on multiple projects at once, so writes are scoped to
// a single project — they never touch the member's rows on other projects.
//
// Body: { userId, cycleId, projectId | null, fromProjectId?, domainId?, level?, domains? }
//   - projectId set → replace this member's Proposed rows ON THAT PROJECT with
//     one Proposed StaffingAssignment per domain. Pass `domains: [{ domainId,
//     level }, ...]` for multi-domain staffing, or the legacy single `domainId`
//     + `level`. Other projects are untouched (this is the additive "add to a
//     second project" path).
//   - fromProjectId set → also remove the member from that source project (a
//     drag MOVE A→B sends projectId=B, fromProjectId=A atomically).
//   - projectId === null + fromProjectId set → remove the member from that one
//     project only (drag to Unassigned / × on a project card). Confirmed rows on
//     that project are Declined so a finalized card actually disappears.
//   - projectId === null + no fromProjectId → full unassign: drop every Proposed
//     row for (userId, cycle) (legacy behaviour, still used by MCP callers).
//
// The schema has no (userId, staffingCycleId) unique constraint — multiple
// proposals across history and across projects are fine.

type DomainLevelBody = { domainId: string; level: Level };

type Body = {
  userId: string;
  cycleId: string;
  projectId: string | null;
  fromProjectId?: string;
  domainId?: string;
  level?: Level;
  domains?: DomainLevelBody[];
};

function parseDomains(o: Record<string, unknown>): DomainLevelBody[] | null {
  if (Array.isArray(o.domains)) {
    if (o.domains.length === 0) return null;
    const out: DomainLevelBody[] = [];
    for (const item of o.domains) {
      if (!item || typeof item !== "object") return null;
      const d = item as Record<string, unknown>;
      if (typeof d.domainId !== "string" || !isLevel(d.level)) return null;
      out.push({ domainId: d.domainId, level: d.level });
    }
    return out;
  }
  if (typeof o.domainId === "string" && isLevel(o.level)) {
    return [{ domainId: o.domainId, level: o.level }];
  }
  return null;
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.userId !== "string") return false;
  if (typeof o.cycleId !== "string") return false;
  if (o.projectId !== null && typeof o.projectId !== "string") return false;
  if (o.fromProjectId !== undefined && typeof o.fromProjectId !== "string") return false;
  if (o.projectId !== null) {
    const domains = parseDomains(o);
    if (!domains) return false;
    (o as Body).domains = domains;
  }
  return true;
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true, termId: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }

  const assignerId = auth.user.sub;
  const domains = body.domains ?? [];

  await prisma.$transaction(async (tx) => {
    if (body.projectId === null && !body.fromProjectId) {
      // Full unassign: drop every Proposed row for this (userId, cycle).
      await tx.staffingAssignment.deleteMany({
        where: {
          userId: body.userId,
          staffingCycleId: body.cycleId,
          status: "Proposed",
        },
      });
      return;
    }

    // Project-scoped write/move/remove. Clear the Proposed rows on the project
    // we're rewriting (projectId) and/or the project we moved away from
    // (fromProjectId); rows on every other project are left intact.
    const projectsToClear = new Set<string>();
    if (body.projectId !== null) projectsToClear.add(body.projectId);
    if (body.fromProjectId) projectsToClear.add(body.fromProjectId);

    await tx.staffingAssignment.deleteMany({
      where: {
        userId: body.userId,
        staffingCycleId: body.cycleId,
        projectId: { in: [...projectsToClear] },
        status: "Proposed",
      },
    });

    // Removing the member from a project (drag to Unassigned / ×): decline any
    // Confirmed rows there so a finalized card leaves the column. On a plain move
    // the target project keeps its Confirmed audit trail (dedup lets the fresh
    // Proposed set win). ProjectAssignment cleanup happens on re-finalize.
    if (body.projectId === null && body.fromProjectId) {
      await tx.staffingAssignment.updateMany({
        where: {
          userId: body.userId,
          staffingCycleId: body.cycleId,
          projectId: body.fromProjectId,
          status: "Confirmed",
        },
        data: { status: "Declined" },
      });
    }

    if (body.projectId !== null) {
      for (const d of domains) {
        await tx.staffingAssignment.create({
          data: {
            userId: body.userId,
            staffingCycleId: body.cycleId,
            projectId: body.projectId,
            termId: cycle.termId,
            domainId: d.domainId,
            level: d.level,
            status: "Proposed",
            assignedById: assignerId,
          },
        });
      }
    }
  });

  await logAuditEvent({
    action: "staffing.assign",
    userId: assignerId,
    targetId: body.userId,
    metadata: {
      cycleId: body.cycleId,
      projectId: body.projectId,
      fromProjectId: body.fromProjectId ?? null,
      domains:
        body.projectId === null
          ? null
          : domains.map((d) => ({ domainId: d.domainId, level: d.level })),
      domainId: domains[0]?.domainId ?? null,
      level: domains[0]?.level ?? null,
    },
    request,
  });

  publishCycleChange(body.cycleId);

  return withCors(request, Response.json({ ok: true }));
}
