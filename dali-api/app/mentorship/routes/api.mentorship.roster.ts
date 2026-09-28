import type { Route } from "./+types/api.mentorship.roster";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors } from "~/lib/cors";

// GET /api/mentorship/roster?projectId=&termId=[&cycleId=] — Core only.
// Candidate pool for the pair editor: the project's staffed domains and its
// roster (one entry per ProjectAssignment). Each member carries an `isMentor`
// flag — level defaults it (P3 → mentor) and, when a cycleId is given, the
// staffing board's per-card role override flips it. With a cycleId, the cycle's
// external mentors for this project are appended too (flagged `external`), so
// the reviewer offers the same mentor pool that finalize derived from.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const termId = url.searchParams.get("termId");
  const cycleId = url.searchParams.get("cycleId");
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

  // Role overrides + external mentors are cycle-scoped; only fold them in when a
  // cycle is in play (the finalize reviewer passes one, the project tab doesn't).
  let overrides = new Map<string, boolean>();
  let externalMembers: {
    id: string;
    firstName: string;
    lastName: string;
    domainId: string;
    level: "P1" | "P2" | "P3";
    isMentor: boolean;
    external: boolean;
  }[] = [];
  if (cycleId) {
    const [overrideRows, externals] = await Promise.all([
      prisma.staffingMentorRole.findMany({
        where: { staffingCycleId: cycleId },
        select: { userId: true, isMentor: true },
      }),
      prisma.externalMentor.findMany({
        where: { staffingCycleId: cycleId, projectId },
        select: {
          userId: true,
          domainId: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    overrides = new Map(overrideRows.map((r) => [r.userId, r.isMentor]));
    externalMembers = externals.map((e) => ({
      id: e.userId,
      firstName: e.user.firstName,
      lastName: e.user.lastName,
      domainId: e.domainId,
      level: "P3" as const,
      isMentor: true,
      external: true,
    }));
  }

  const domainIds = [
    ...new Set([
      ...assignments.map((a) => a.domainId),
      ...externalMembers.map((e) => e.domainId),
    ]),
  ];
  const domains = await prisma.domain.findMany({
    where: { id: { in: domainIds } },
    select: { id: true, code: true, displayName: true },
    orderBy: { code: "asc" },
  });

  const rosterMembers = assignments.map((a) => ({
    id: a.userId,
    firstName: a.user.firstName,
    lastName: a.user.lastName,
    domainId: a.domainId,
    level: a.level,
    isMentor: overrides.get(a.userId) ?? a.level === "P3",
    external: false,
  }));

  const members = [...rosterMembers, ...externalMembers].sort((x, y) =>
    `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`),
  );

  return withCors(request, Response.json({ domains, members }));
}
