import type { Route } from "./+types/api.staffing.mentor-role";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../lib/staffing-events.server";

// Per-card mentor/mentee role on the staffing board. A member's role defaults
// to their level (P3 → mentor, else mentee); a StaffingMentorRole row overrides
// it when a manager clicks the card's role badge. Gated to staffing managers.
//
//   GET  ?cycleId=
//          → { overrides: { [userId]: boolean }, nonP3Mentors: [{ userId, firstName, lastName }] }
//        overrides drives each card's badge; nonP3Mentors are effective mentors
//        who aren't P3 yet (finalize offers to promote them).
//   POST { cycleId, userId, isMentor }
//          → upsert the override (idempotent on cycle+user).

type PostBody = { cycleId: string; userId: string; isMentor: boolean };

function isPostBody(x: unknown): x is PostBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.userId === "string" &&
    typeof o.isMentor === "boolean"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) return forbidden(request);

  const url = new URL(request.url);
  const cycleId = url.searchParams.get("cycleId");
  if (!cycleId) {
    return withCors(request, Response.json({ error: "cycleId required" }, { status: 400 }));
  }

  const [overrideRows, assignments] = await Promise.all([
    prisma.staffingMentorRole.findMany({
      where: { staffingCycleId: cycleId },
      select: { userId: true, isMentor: true },
    }),
    prisma.staffingAssignment.findMany({
      where: { staffingCycleId: cycleId, status: { not: "Declined" } },
      select: {
        userId: true,
        level: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const overrides: Record<string, boolean> = {};
  for (const r of overrideRows) overrides[r.userId] = r.isMentor;

  // Effective mentors who aren't P3 in any staffed domain — finalize can promote
  // them. Only override-driven mentors qualify: a default mentor is P3 already.
  const isP3Somewhere = new Set<string>();
  const nameByUser = new Map<string, { firstName: string; lastName: string }>();
  for (const a of assignments) {
    nameByUser.set(a.userId, a.user);
    if (a.level === "P3") isP3Somewhere.add(a.userId);
  }
  const nonP3Mentors = overrideRows
    .filter((r) => r.isMentor && !isP3Somewhere.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      firstName: nameByUser.get(r.userId)?.firstName ?? "",
      lastName: nameByUser.get(r.userId)?.lastName ?? "",
    }));

  return withCors(request, Response.json({ overrides, nonP3Mentors }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isPostBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const [cycle, user] = await Promise.all([
    prisma.staffingCycle.findUnique({ where: { id: body.cycleId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
  ]);
  if (!cycle || !user) {
    return withCors(request, Response.json({ error: "Unknown cycle or user" }, { status: 404 }));
  }

  await prisma.staffingMentorRole.upsert({
    where: {
      staffingCycleId_userId: { staffingCycleId: body.cycleId, userId: body.userId },
    },
    update: { isMentor: body.isMentor },
    create: {
      staffingCycleId: body.cycleId,
      userId: body.userId,
      isMentor: body.isMentor,
      createdById: auth.user.sub,
    },
  });

  await logAuditEvent({
    action: "staffing.mentorRole.set",
    userId: auth.user.sub,
    targetId: body.userId,
    metadata: { cycleId: body.cycleId, isMentor: body.isMentor },
    request,
  });
  publishCycleChange(body.cycleId);

  return withCors(request, Response.json({ ok: true }));
}
