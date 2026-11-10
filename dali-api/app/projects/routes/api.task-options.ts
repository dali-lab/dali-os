import type { Route } from "./+types/api.task-options";
import { prisma } from "~/lib/db.server";
import { requireAuth, requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { fullName } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { currentTerm, isCore } from "~/lib/roles";
import { assignableAssignments } from "../lib/task-board";

// GET /api/task-options — active projects the caller can add tasks to.
// GET /api/task-options?projectId= — that project's assignable team.
// Both feed the doc editor's /task composer and task block.
export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (projectId) {
    const gate = await requireProjectEditAccess(request, projectId);
    if (!gate.ok) return gate.response;
    const [term, assignments] = await Promise.all([
      currentTerm(request),
      prisma.projectAssignment.findMany({
        where: { projectId },
        select: {
          termId: true,
          term: { select: { sortKey: true } },
          user: { select: USER_NAME_SELECT },
        },
      }),
    ]);
    const names = new Map<string, string>();
    for (const a of assignableAssignments(assignments, term?.id ?? null)) {
      names.set(a.user.id, fullName(a.user));
    }
    const members = [...names.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return withCors(request, Response.json({ members }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const core = await isCore(auth.user.sub);
  const projects = await prisma.project.findMany({
    where: {
      status: "Active",
      ...(core ? {} : { assignments: { some: { userId: auth.user.sub } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return withCors(request, Response.json({ projects }));
}
