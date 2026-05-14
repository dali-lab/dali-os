import type { Route } from "./+types/api.cycles.$cycleId.my-interviews";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const member = await prisma.dALIMember.findUnique({ where: { userId: auth.user.sub } });
  if (!member) return withCors(request, Response.json([]));

  const interviewer = await prisma.cycleInterviewer.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: params.cycleId },
  });
  if (!interviewer) return withCors(request, Response.json([]));

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  const assignments = await prisma.interviewAssignment.findMany({
    where: { cycleInterviewerId: interviewer.id, status: "Active" },
    include: {
      interview: {
        include: {
          domainApplication: {
            include: {
              application: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
              challengeVersion: { include: { domain: true } },
            },
          },
          assignments: {
            where: { status: "Active" },
            include: {
              cycleInterviewer: {
                include: {
                  user: true,
                  domain: true,
                },
              },
            },
          },
        },
      },
      noteVersions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { interview: { startTime: "asc" } },
  });

  return withCors(request, Response.json(assignments));
}
