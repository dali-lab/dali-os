import type { Route } from "./+types/api.projects.$id.sprint-anchor";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { ensureSprints, setSprintAnchor } from "../lib/sprints.server";
import { labTodayUtcDay } from "~/lib/timezone";

// POST /api/projects/:id/sprint-anchor { termId, anchorDay } — the weekday the
// team's sprints start on that term. Rebuilds upcoming sprints only.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    termId?: unknown;
    anchorDay?: unknown;
  } | null;
  const anchorDay = body?.anchorDay;
  if (
    typeof body?.termId !== "string" ||
    typeof anchorDay !== "number" ||
    !Number.isInteger(anchorDay) ||
    anchorDay < 0 ||
    anchorDay > 6
  ) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  const pt = await prisma.projectTerm.findUnique({
    where: { projectId_termId: { projectId: params.id!, termId: body.termId } },
    select: { term: { select: { endDate: true } } },
  });
  if (!pt) {
    return withCors(request, Response.json({ error: "Term is not part of this project" }, { status: 400 }));
  }
  if (pt.term.endDate.getTime() < labTodayUtcDay(new Date())) {
    return withCors(request, Response.json({ error: "That term has ended" }, { status: 400 }));
  }
  await ensureSprints(params.id!);
  await setSprintAnchor(params.id!, body.termId, anchorDay);
  return withCors(request, Response.json({ ok: true }));
}
