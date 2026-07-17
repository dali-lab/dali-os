import type { Route } from "./+types/api.mentorship.pairs";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { canViewMentorship } from "../lib/visibility";

// GET    /api/mentorship/pairs — list pairs. Filters: projectId, termId,
//        mentorUserId, menteeUserId. Visible to any lab mentor / Core.
// POST   /api/mentorship/pairs — manual create. Core only.
//        Body: { menteeUserId, mentorUserId, projectId, termId, domainId }
// DELETE /api/mentorship/pairs?id=...&id=... — delete by id. Core only.
//        Supports one or more id query params for batch removal.

type CreateBody = {
  menteeUserId: string;
  mentorUserId: string;
  projectId: string;
  termId: string;
  domainId: string;
};

function isCreateBody(x: unknown): x is CreateBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.menteeUserId === "string" &&
    typeof o.mentorUserId === "string" &&
    typeof o.projectId === "string" &&
    typeof o.termId === "string" &&
    typeof o.domainId === "string"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canViewMentorship(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const url = new URL(request.url);
  const where: Record<string, unknown> = {};
  const projectId = url.searchParams.get("projectId");
  const termId = url.searchParams.get("termId");
  const mentorUserId = url.searchParams.get("mentorUserId");
  const menteeUserId = url.searchParams.get("menteeUserId");
  if (projectId) where.projectId = projectId;
  if (termId) where.termId = termId;
  if (mentorUserId) where.mentorUserId = mentorUserId;
  if (menteeUserId) where.menteeUserId = menteeUserId;

  const pairs = await prisma.mentorshipPair.findMany({
    where,
    take: 500,
    select: {
      id: true,
      projectId: true,
      termId: true,
      domainId: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const termIds = [...new Set(pairs.map((p) => p.termId))];
  const domainIds = [...new Set(pairs.map((p) => p.domainId))];
  const [projects, terms, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.term.findMany({
      where: { id: { in: termIds } },
      select: { id: true, code: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, code: true, displayName: true },
    }),
  ]);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const termMap = new Map(terms.map((t) => [t.id, t]));
  const domainMap = new Map(domains.map((d) => [d.id, d]));

  return withCors(
    request,
    Response.json({
      pairs: pairs.map((p) => ({
        id: p.id,
        mentor: p.mentor,
        mentee: p.mentee,
        project: projectMap.get(p.projectId) ?? { id: p.projectId, name: "Unknown" },
        term: termMap.get(p.termId) ?? { id: p.termId, code: "?" },
        domain: domainMap.get(p.domainId) ?? { id: p.domainId, code: "?", displayName: "Unknown" },
      })),
    }),
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const ids = url.searchParams.getAll("id").filter(Boolean);
    if (ids.length === 0) {
      return withCors(request, Response.json({ error: "No ids provided" }, { status: 400 }));
    }
    const result = await prisma.mentorshipPair.deleteMany({ where: { id: { in: ids } } });
    return withCors(request, Response.json({ deleted: result.count }));
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

  // Avoid creating an exact duplicate (no unique constraint on the model).
  const dupe = await prisma.mentorshipPair.findFirst({
    where: {
      menteeUserId: body.menteeUserId,
      mentorUserId: body.mentorUserId,
      projectId: body.projectId,
      termId: body.termId,
      domainId: body.domainId,
    },
    select: { id: true },
  });
  if (dupe) {
    return withCors(request, Response.json({ id: dupe.id, created: false }));
  }
  const created = await prisma.mentorshipPair.create({
    data: {
      menteeUserId: body.menteeUserId,
      mentorUserId: body.mentorUserId,
      projectId: body.projectId,
      termId: body.termId,
      domainId: body.domainId,
    },
    select: { id: true },
  });
  return withCors(request, Response.json({ id: created.id, created: true }));
}
