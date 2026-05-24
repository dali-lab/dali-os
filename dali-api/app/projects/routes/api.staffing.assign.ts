import type { Route } from "./+types/api.staffing.assign";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST /api/staffing/assign
//
// Body: { userId, cycleId, projectId | null, domainId, level }
//   - projectId === null → move the member back to Unassigned (delete their
//     Proposed StaffingAssignment for this cycle).
//   - projectId set → upsert a Proposed StaffingAssignment for (userId, cycleId)
//     pointing at the target project. The board is the single source of
//     proposed state, so we clear any prior Proposed row for the same
//     user+cycle in the same transaction.
//
// The schema has no (userId, staffingCycleId) unique constraint — multiple
// proposals across history are fine; we just want "at most one Proposed at a
// time per (user, cycle)".

type Body = {
  userId: string;
  cycleId: string;
  projectId: string | null;
  domainId?: string;
  level?: "P1" | "P2" | "P3";
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.userId !== "string") return false;
  if (typeof o.cycleId !== "string") return false;
  if (o.projectId !== null && typeof o.projectId !== "string") return false;
  if (o.projectId !== null) {
    if (typeof o.domainId !== "string") return false;
    if (o.level !== "P1" && o.level !== "P2" && o.level !== "P3") return false;
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
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
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

  await prisma.$transaction(async (tx) => {
    // Drop any prior Proposed row for this (userId, cycle). Confirmed +
    // Declined rows are kept as audit trail.
    await tx.staffingAssignment.deleteMany({
      where: {
        userId: body.userId,
        staffingCycleId: body.cycleId,
        status: "Proposed",
      },
    });

    if (body.projectId !== null) {
      await tx.staffingAssignment.create({
        data: {
          userId: body.userId,
          staffingCycleId: body.cycleId,
          projectId: body.projectId,
          termId: cycle.termId,
          domainId: body.domainId!,
          level: body.level!,
          status: "Proposed",
          assignedById: assignerId,
        },
      });
    }
  });

  await logAuditEvent({
    action: "staffing.assign",
    userId: assignerId,
    targetId: body.userId,
    metadata: {
      cycleId: body.cycleId,
      projectId: body.projectId,
      domainId: body.domainId ?? null,
      level: body.level ?? null,
    },
    request,
  });

  return withCors(request, Response.json({ ok: true }));
}
