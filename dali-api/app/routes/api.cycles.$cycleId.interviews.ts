import type { Route } from "./+types/api.cycles.$cycleId.interviews";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { hasCycleAccess } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const interviews = await prisma.interview.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      domainApplication: {
        include: {
          application: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          challengeVersion: { include: { domain: true } },
        },
      },
      assignments: {
        include: {
          cycleInterviewer: {
            include: {
              daliMember: true,
              domain: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: "asc" },
  });

  return withAuth(auth, withCors(request, Response.json(interviews)));
}
