import type { Route } from "./+types/api.task-options";
import { prisma } from "~/lib/db.server";
import { requireAuth, requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { fullName } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { currentTerm, getUserRoles, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { listActiveCoreMembers } from "~/lib/core-members.server";
import { getCoreBoardProject } from "~/core/lib/taskboard.server";
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
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { kind: true } });
    if (project?.kind === "CoreBoard") {
      return withCors(request, Response.json({ members: await listActiveCoreMembers(request) }));
    }
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
  const userId = auth.user.sub;
  const core = await isCore(userId);
  const [projects, coreBoard] = await Promise.all([
    prisma.project.findMany({
      where: {
        status: "Active",
        kind: "Standard",
        ...(core ? {} : { assignments: { some: { userId } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    core && (await isFeatureEnabled("core-taskboard", userId, await getUserRoles(userId, request)))
      ? getCoreBoardProject()
      : null,
  ]);
  return withCors(request, Response.json({ projects: coreBoard ? [coreBoard, ...projects] : projects }));
}
