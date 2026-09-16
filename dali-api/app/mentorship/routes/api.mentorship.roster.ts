import type { Route } from "./+types/api.mentorship.roster";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors } from "~/lib/cors";

// GET /api/mentorship/roster?projectId=&termId= — Core only.
// Candidate pool for the manual pair editor: the project's staffed domains and
// its roster (one entry per ProjectAssignment, carrying the member's domain and
// level). Pairs are project+domain scoped, so the editor picks a domain, then a
// mentor + mentee from that domain's roster — level defaults the role but Core
// may pick freely. Cross-project/external mentors are added via the staffing
// board (which auto-derives the pair); this pool is intentionally roster-scoped.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const termId = url.searchParams.get("termId");
  if (!projectId || !termId) {
    return withCors(
      request,
      Response.json({ error: "projectId and termId required" }, { status: 400 }),
    );
  }

  const assignments = await prisma.projectAssignment.findMany({
    where: { projectId, termId },
    select: {
      userId: true,
      domainId: true,
      level: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });

  const domainIds = [...new Set(assignments.map((a) => a.domainId))];
  const domains = await prisma.domain.findMany({
    where: { id: { in: domainIds } },
    select: { id: true, code: true, displayName: true },
    orderBy: { code: "asc" },
  });

  const members = assignments
    .map((a) => ({
      id: a.userId,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      domainId: a.domainId,
      level: a.level,
    }))
    .sort((x, y) =>
      `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`),
    );

  return withCors(request, Response.json({ domains, members }));
}
