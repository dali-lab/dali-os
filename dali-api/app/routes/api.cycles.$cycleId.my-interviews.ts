import type { Route } from "./+types/api.cycles.$cycleId.my-interviews";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Find the reviewer record for the authenticated user in this cycle
  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) return withCors(request, Response.json([]));

  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { daliMemberId: member.id, applicationCycleId: params.cycleId },
  });
  if (!reviewer) return withCors(request, Response.json([]));

  const assignments = await prisma.interviewAssignment.findMany({
    where: { cycleReviewerId: reviewer.id, status: "Active" },
    include: {
      interview: {
        include: {
          application: {
            include: {
              user: { select: { firstName: true, lastName: true } },
              domainApplications: { include: { challengeVersion: { include: { domain: true } } } },
            },
          },
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
