import type { Route } from "./+types/api.staffing.board-member";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { primaryEmail } from "~/lib/display";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../lib/staffing-events.server";

// Staffing board membership for non-bidders.
//
//   GET  /api/staffing/board-member?cycleId=&q=
//        Search DALI members (by name/email) to add to the board. Excludes
//        users already on the board for this cycle (a bid, an assignment, or an
//        existing StaffingBoardMember row). Returns up to 10 matches.
//
//   POST /api/staffing/board-member  { cycleId, userId }
//        Upsert a StaffingBoardMember so the user shows as an Unassigned card.
//
//   DELETE /api/staffing/board-member  { cycleId, userId }
//        Remove the manual board placement. Only removes the StaffingBoardMember
//        row — it never touches the member's bids or assignments, so a member
//        who also bid stays on the board.
//
// All paths require canManageStaffing.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  const url = new URL(request.url);
  const cycleId = url.searchParams.get("cycleId");
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!cycleId) {
    return withCors(request, Response.json({ error: "cycleId required" }, { status: 400 }));
  }
  if (q.length < 2) {
    return withCors(request, Response.json({ results: [] }));
  }

  // Already-on-the-board user ids: bidders, proposed-assignees, and existing
  // manual board members. Excluded from search so the lead can't double-add.
  const [prefs, assigns, board] = await Promise.all([
    prisma.staffingPreference.findMany({
      where: { staffingCycleId: cycleId },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.staffingAssignment.findMany({
      where: { staffingCycleId: cycleId, status: "Proposed" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.staffingBoardMember.findMany({
      where: { staffingCycleId: cycleId },
      select: { userId: true },
    }),
  ]);
  const onBoard = new Set([
    ...prefs.map((p) => p.userId),
    ...assigns.map((a) => a.userId),
    ...board.map((b) => b.userId),
  ]);

  // Per-token AND match across first/last/email, so "ada o" matches "Ada
  // O'Brien". Members only (daliMember present) — the staff-able pool.
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 4);
  const users = await prisma.user.findMany({
    where: {
      daliMember: { isNot: null },
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { daliEmail: { contains: t, mode: "insensitive" as const } },
          { dartmouthEmail: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 25,
  });

  const results = users
    .filter((u) => !onBoard.has(u.id))
    .slice(0, 10)
    .map((u) => ({
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: primaryEmail(u) ?? null,
    }));

  return withCors(request, Response.json({ results }));
}

type MutateBody = { cycleId: string; userId: string };

function isMutateBody(x: unknown): x is MutateBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.cycleId === "string" && typeof o.userId === "string";
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
  }
  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isMutateBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.staffingBoardMember.deleteMany({
      where: { staffingCycleId: body.cycleId, userId: body.userId },
    });
    await logAuditEvent({
      action: "staffing.board-member.remove",
      userId: auth.user.sub,
      targetId: body.userId,
      metadata: { cycleId: body.cycleId },
      request,
    });
    publishCycleChange(body.cycleId);
    return withCors(request, Response.json({ ok: true }));
  }

  // POST: must be a real DALI member.
  const user = await prisma.user.findFirst({
    where: { id: body.userId, daliMember: { isNot: null } },
    select: { id: true },
  });
  if (!user) {
    return withCors(request, Response.json({ error: "User is not a DALI member" }, { status: 400 }));
  }

  // Idempotent: re-adding an existing board member is a no-op.
  await prisma.staffingBoardMember.upsert({
    where: {
      userId_staffingCycleId: { userId: body.userId, staffingCycleId: body.cycleId },
    },
    update: {},
    create: {
      userId: body.userId,
      staffingCycleId: body.cycleId,
      addedById: auth.user.sub,
    },
  });
  await logAuditEvent({
    action: "staffing.board-member.add",
    userId: auth.user.sub,
    targetId: body.userId,
    metadata: { cycleId: body.cycleId },
    request,
  });
  publishCycleChange(body.cycleId);
  return withCors(request, Response.json({ ok: true }));
}
