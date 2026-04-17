import type { Route } from "./+types/api.my-application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Prefer the user's most recent application — its cycle is the one they care
  // about. Falling back to the latest cycle (when no application exists) lets
  // applicants who haven't yet applied see the open cycle so they can start.
  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: {
        include: { challengeVersion: { select: { domainId: true } } },
      },
      applicationCycle: {
        include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let cycle = application?.applicationCycle ?? null;
  if (!cycle) {
    cycle = await prisma.applicationCycle.findFirst({
      orderBy: { createdAt: "desc" },
      include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
  }

  if (!cycle) {
    return withCors(request, Response.json({ application: null, interview: null, cycleStatus: null }));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";

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
      domainApplication: { applicationId: application.id },
      status: "Scheduled",
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
