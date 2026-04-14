import type { Route } from "./+types/api.cycles.$cycleId.interviews";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const interviews = await prisma.interview.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      application: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          domainApplications: { include: { challengeVersion: { include: { domain: true } } } },
        },
      },
      assignments: {
        include: {
          cycleReviewer: {
            include: {
              daliMember: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
              domain: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(interviews));
}
