import type { Route } from "./+types/api.staffing.reorder";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../lib/staffing-events.server";

// POST /api/staffing/reorder
//
// Body: { cycleId, columnKey, userIds: string[] }
//   Persist the order of cards in one board column. `userIds` is the column's
//   full membership in display order; we write each user's index as its
//   sortKey. `columnKey` is a project id or "__unassigned__".
//
// One StaffingCardOrder row per (cycle, user), upserted. Column membership
// itself is derived from assignments elsewhere (the assign endpoint) — this
// endpoint only records position, so it never moves a card between columns.

type Body = { cycleId: string; columnKey: string; userIds: string[] };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.columnKey === "string" &&
    Array.isArray(o.userIds) &&
    o.userIds.every((u) => typeof u === "string")
  );
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
    select: { id: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }

  // Write each user's position as its index in the supplied order. Upsert keeps
  // it idempotent and re-homes a card's columnKey when it lands in a new column.
  await prisma.$transaction(
    body.userIds.map((userId, index) =>
      prisma.staffingCardOrder.upsert({
        where: {
          staffingCycleId_userId: { staffingCycleId: body.cycleId, userId },
        },
        update: { columnKey: body.columnKey, sortKey: index },
        create: {
          staffingCycleId: body.cycleId,
          userId,
          columnKey: body.columnKey,
          sortKey: index,
        },
      }),
    ),
  );

  await logAuditEvent({
    action: "staffing.reorder",
    userId: auth.user.sub,
    targetId: body.cycleId,
    metadata: { columnKey: body.columnKey, count: body.userIds.length },
    request,
  });

  publishCycleChange(body.cycleId);

  return withCors(request, Response.json({ ok: true }));
}
