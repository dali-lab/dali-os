import type { Route } from "./+types/api.my-application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Find the latest cycle
  const cycle = await prisma.applicationCycle.findFirst({
    orderBy: { createdAt: "desc" },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!cycle) {
    return withCors(request, Response.json({ application: null, interview: null, cycleStatus: null }));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";

  // Find the user's application for this cycle
  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: cycle.id },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: {
        include: { challengeVersion: { select: { domainId: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!application) {
    return withCors(request, Response.json({
      application: null,
      interview: null,
      cycleStatus,
      cycleId: cycle.id,
    }));
  }

  const appStatus = application.statusUpdates[0]?.newStatus ?? "Draft";
  const domainIds = application.domainApplications.map(
    (da) => da.challengeVersion.domainId,
  );

  // Find active interview for this application
  const interview = await prisma.interview.findFirst({
    where: {
      applicationId: application.id,
      status: { in: ["Scheduled", "NeedsReassignment"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return withCors(request, Response.json({
    application: {
      id: application.id,
      applicationCycleId: application.applicationCycleId,
      status: appStatus,
      domainIds,
    },
    interview: interview
      ? { id: interview.id, startTime: interview.startTime, endTime: interview.endTime, status: interview.status }
      : null,
    cycleStatus,
    cycleId: cycle.id,
  }));
}
