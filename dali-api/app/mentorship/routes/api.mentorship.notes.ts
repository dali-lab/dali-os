import type { Route } from "./+types/api.mentorship.notes";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { canViewMentorship } from "../lib/visibility";
import { startOfWeekUTC } from "../lib/week";

// GET  /api/mentorship/notes — filterable note list. Any lab mentor or Core
//      member can read any note (mentor-collective). Mentees are not granted
//      access by this endpoint. Filters (all optional, AND-combined):
//        mentorId, menteeId, projectId, termId, domainId, weekOf (yyyy-mm-dd)
//      Returns notes ordered by weekOf desc, with denormalized labels.
//
// POST /api/mentorship/notes — upsert "this user's note for (mentee, project,
//      term, domain, weekOf)". Always created against the caller as mentor;
//      that's the only authorial path the UI offers. If a row already exists
//      for that combination it is returned as-is (idempotent open-or-create).
//      Newly created notes get their contentJson pre-filled from the current
//      default MentorNoteTemplate, if one exists.

type UpsertBody = {
  menteeId: string;
  projectId: string;
  termId: string;
  domainId: string;
  weekOf: string;
};

function isUpsertBody(x: unknown): x is UpsertBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.menteeId === "string" &&
    typeof o.projectId === "string" &&
    typeof o.termId === "string" &&
    typeof o.domainId === "string" &&
    typeof o.weekOf === "string"
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
  const mentorId = url.searchParams.get("mentorId");
  const menteeId = url.searchParams.get("menteeId");
  const projectId = url.searchParams.get("projectId");
  const termId = url.searchParams.get("termId");
  const domainId = url.searchParams.get("domainId");
  const weekOf = url.searchParams.get("weekOf");
  if (mentorId) where.mentorId = mentorId;
  if (menteeId) where.menteeId = menteeId;
  if (projectId) where.projectId = projectId;
  if (termId) where.termId = termId;
  if (domainId) where.domainId = domainId;
  if (weekOf) where.weekOf = startOfWeekUTC(weekOf);

  const notes = await prisma.mentorNote.findMany({
    where,
    orderBy: [{ weekOf: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      updatedAt: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Denormalize project + term + domain in one go for the list view.
  const projectIds = [...new Set(notes.map((n) => n.projectId))];
  const termIds = [...new Set(notes.map((n) => n.termId))];
  const domainIds = [...new Set(notes.map((n) => n.domainId))];
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
      notes: notes.map((n) => ({
        id: n.id,
        weekOf: n.weekOf.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        mentor: n.mentor,
        mentee: n.mentee,
        project: projectMap.get(n.projectId) ?? { id: n.projectId, name: "Unknown" },
        term: termMap.get(n.termId) ?? { id: n.termId, code: "?" },
        domain: domainMap.get(n.domainId) ?? { id: n.domainId, code: "?", displayName: "Unknown" },
      })),
    }),
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
  if (!(await canViewMentorship(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isUpsertBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const weekOf = startOfWeekUTC(body.weekOf);
  if (!Number.isFinite(weekOf.getTime())) {
    return withCors(request, Response.json({ error: "Invalid weekOf" }, { status: 400 }));
  }

  // Idempotent open-or-create. Schema enforces uniqueness on
  // (mentor, mentee, project, term, domain, weekOf) so a second call returns
  // the same row.
  const existing = await prisma.mentorNote.findUnique({
    where: {
      mentorId_menteeId_projectId_termId_domainId_weekOf: {
        mentorId: auth.user.sub,
        menteeId: body.menteeId,
        projectId: body.projectId,
        termId: body.termId,
        domainId: body.domainId,
        weekOf,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return withCors(request, Response.json({ id: existing.id, created: false }));
  }

  // Seed from the current default template when present. Otherwise leave the
  // ProseMirror doc empty ({}). The editor will render an empty StarterKit doc.
  const template = await prisma.mentorNoteTemplate.findFirst({
    where: { isDefault: true },
    select: { contentJson: true },
  });

  const created = await prisma.mentorNote.create({
    data: {
      mentorId: auth.user.sub,
      menteeId: body.menteeId,
      projectId: body.projectId,
      termId: body.termId,
      domainId: body.domainId,
      weekOf,
      contentJson: (template?.contentJson ?? {}) as object,
    },
    select: { id: true },
  });
  return withCors(request, Response.json({ id: created.id, created: true }));
}
