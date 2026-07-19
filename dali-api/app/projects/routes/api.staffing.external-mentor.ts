import type { Route } from "./+types/api.staffing.external-mentor";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { primaryEmail } from "~/lib/display";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../lib/staffing-events.server";

// External mentors on the staffing board: an existing DALI member (typically on
// another project) who mentors this project's mentees in one domain. Rendered as
// a distinct card; at finalize they're paired to the project's same-domain
// mentees. Gated to staffing managers.
//
//   GET  ?cycleId=                      → { externalMentors: [...] } (list)
//   GET  ?cycleId=&projectId=&q=Ada     → { results: [{ userId, name, email }] } (member search)
//   POST { cycleId, projectId, domainId, userId }  → add placement
//   DELETE ?id=…                        → remove placement

type CreateBody = {
  cycleId: string;
  projectId: string;
  domainId: string;
  userId: string;
};

function isCreateBody(x: unknown): x is CreateBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.projectId === "string" &&
    typeof o.domainId === "string" &&
    typeof o.userId === "string"
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

  // Member search mode: pick an existing member to add as an external mentor.
  if (url.searchParams.has("q")) {
    const projectId = url.searchParams.get("projectId") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return withCors(request, Response.json({ results: [] }));

    // Exclude members already staffed on this project (they're internal) and
    // members already placed as an external mentor here.
    const [assigned, existing] = await Promise.all([
      projectId
        ? prisma.staffingAssignment.findMany({
            where: { staffingCycleId: cycleId, projectId, status: { not: "Declined" } },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
      projectId
        ? prisma.externalMentor.findMany({
            where: { staffingCycleId: cycleId, projectId },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
    ]);
    const exclude = new Set([...assigned.map((a) => a.userId), ...existing.map((e) => e.userId)]);

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
      select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 25,
    });
    const results = users
      .filter((u) => !exclude.has(u.id))
      .slice(0, 10)
      .map((u) => ({
        userId: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: primaryEmail(u) ?? null,
      }));
    return withCors(request, Response.json({ results }));
  }

  const rows = await prisma.externalMentor.findMany({
    where: { staffingCycleId: cycleId },
    select: {
      id: true,
      projectId: true,
      domainId: true,
      userId: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  return withCors(
    request,
    Response.json({
      externalMentors: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        domainId: r.domainId,
        userId: r.userId,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
      })),
    }),
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) return forbidden(request);

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return withCors(request, Response.json({ error: "id required" }, { status: 400 }));
    }
    const row = await prisma.externalMentor.findUnique({
      where: { id },
      select: { staffingCycleId: true },
    });
    if (!row) return withCors(request, Response.json({ ok: true }));
    await prisma.externalMentor.delete({ where: { id } });
    await logAuditEvent({
      action: "staffing.externalMentor.remove",
      userId: auth.user.sub,
      targetId: id,
      request,
    });
    publishCycleChange(row.staffingCycleId);
    return withCors(request, Response.json({ ok: true }));
  }

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isCreateBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const [cycle, project, domain, user] = await Promise.all([
    prisma.staffingCycle.findUnique({ where: { id: body.cycleId }, select: { id: true } }),
    prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true } }),
    prisma.domain.findUnique({ where: { id: body.domainId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
  ]);
  if (!cycle || !project || !domain || !user) {
    return withCors(request, Response.json({ error: "Unknown cycle, project, domain, or user" }, { status: 404 }));
  }

  const placement = await prisma.externalMentor.upsert({
    where: {
      staffingCycleId_projectId_userId_domainId: {
        staffingCycleId: body.cycleId,
        projectId: body.projectId,
        userId: body.userId,
        domainId: body.domainId,
      },
    },
    update: {},
    create: {
      staffingCycleId: body.cycleId,
      projectId: body.projectId,
      domainId: body.domainId,
      userId: body.userId,
      createdById: auth.user.sub,
    },
    select: { id: true },
  });

  await logAuditEvent({
    action: "staffing.externalMentor.add",
    userId: auth.user.sub,
    targetId: body.projectId,
    metadata: { userId: body.userId, domainId: body.domainId },
    request,
  });
  publishCycleChange(body.cycleId);

  return withCors(request, Response.json({ id: placement.id }));
}
