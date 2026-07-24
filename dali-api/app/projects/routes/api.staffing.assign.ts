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
// Body: { userId, cycleId, projectId | null, domainId?, level?, domains? }
//   - projectId === null → move the member back to Unassigned (delete their
//     Proposed StaffingAssignment for this cycle).
//   - projectId set → replace Proposed rows for (userId, cycleId) with one
//     Proposed StaffingAssignment per domain (all on the same project). Pass
//     `domains: [{ domainId, level }, ...]` for multi-domain staffing, or the
//     legacy single `domainId` + `level`.
//
// The schema has no (userId, staffingCycleId) unique constraint — multiple
// proposals across history are fine; we just want "at most one Proposed set at
// a time per (user, cycle)" covering every selected domain.

type DomainLevelBody = { domainId: string; level: Level };

type Body = {
  userId: string;
  cycleId: string;
  projectId: string | null;
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
    // Drop any prior Proposed rows for this (userId, cycle). Confirmed +
    // Declined rows are kept as audit trail.
    await tx.staffingAssignment.deleteMany({
      where: {
        userId: body.userId,
        staffingCycleId: body.cycleId,
        status: "Proposed",
      },
    });

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
