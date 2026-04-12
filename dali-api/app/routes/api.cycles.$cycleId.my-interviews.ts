import type { Route } from "./+types/api.cycles.$cycleId.my-interviews";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // Dev: use first reviewer for the cycle when no auth
  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { applicationCycleId: params.cycleId },
  });
  if (!reviewer) {
    return withCors(request, Response.json([]));
  }

  const assignments = await prisma.interviewAssignment.findMany({
    where: { cycleReviewerId: reviewer.id, status: "Active" },
    include: {
      interview: {
        include: {
          application: { include: { user: true } },
          assignments: {
            where: { status: "Active" },
            include: { cycleReviewer: { include: { daliMember: { include: { user: true } }, domain: true } } },
          },
        },
      },
    },
    orderBy: { interview: { startTime: "asc" } },
  });

  return withCors(request, Response.json(assignments));
}
