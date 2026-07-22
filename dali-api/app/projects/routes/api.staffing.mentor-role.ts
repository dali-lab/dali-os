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
//   GET  ?cycleId=&projectId=
//          → { overrides: { [userId]: boolean }, nonP3Mentors: [{ userId, firstName, lastName }] }
//        overrides drives each card's badge (cycle-wide). nonP3Mentors are
//        override mentors on the given project who aren't P3 there yet
//        (finalize offers to promote them). Without projectId, nonP3Mentors
//        is empty — avoid surfacing mentors from other projects.
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
  const projectId = url.searchParams.get("projectId");
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
        projectId: true,
        level: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const overrides: Record<string, boolean> = {};
  for (const r of overrideRows) overrides[r.userId] = r.isMentor;

  // Finalize promote list is project-scoped: only override mentors live-assigned
  // to this project who aren't P3 on that project. Cycle-wide overrides for
  // people on other projects must not appear when finalizing an unrelated one.
  let nonP3Mentors: { userId: string; firstName: string; lastName: string }[] = [];
  if (projectId) {
    const onProject = assignments.filter((a) => a.projectId === projectId);
    const onProjectIds = new Set(onProject.map((a) => a.userId));
    const isP3OnProject = new Set(
      onProject.filter((a) => a.level === "P3").map((a) => a.userId),
    );
    const nameByUser = new Map<string, { firstName: string; lastName: string }>();
    for (const a of onProject) nameByUser.set(a.userId, a.user);
    nonP3Mentors = overrideRows
      .filter((r) => r.isMentor && onProjectIds.has(r.userId) && !isP3OnProject.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        firstName: nameByUser.get(r.userId)?.firstName ?? "",
        lastName: nameByUser.get(r.userId)?.lastName ?? "",
      }));
  }

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
