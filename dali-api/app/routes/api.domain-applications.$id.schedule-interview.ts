import type { Route } from "./+types/api.domain-applications.$id.schedule-interview";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { assignInterviewers } from "~/lib/scheduling";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { startTime } = body;
  if (!startTime) {
    return Response.json({ error: "startTime is required" }, { status: 400 });
  }

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      application: true,
      challengeVersion: { select: { domainId: true } },
      // Only the active row (if any) — historical Cancelled/Completed rows
      // don't block a fresh booking.
      interviews: { where: { status: "Scheduled" } },
    },
  });

  if (!da) {
    return Response.json({ error: "Domain application not found" }, { status: 404 });
  }

  if (da.application.userId !== auth.user.sub) {
    return Response.json({ error: "Not your application" }, { status: 403 });
  }

  if (da.interviews.length > 0) {
    return Response.json({ error: "Interview already scheduled" }, { status: 409 });
  }

  // DomainApplications always attach to a domain-scoped challenge version.
  // The general application form has `domainId = null`, but DomainApplication
  // rows are never created for general forms — defensive guard in case that
  // invariant ever breaks.
  if (!da.challengeVersion.domainId) {
    return Response.json({ error: "Domain application is not attached to a domain" }, { status: 400 });
  }

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: da.application.applicationCycleId },
  });
  if (!config) {
    return Response.json({ error: "No interview config for this cycle" }, { status: 400 });
  }

  const slotStart = new Date(startTime);
  const slotEnd = new Date(slotStart.getTime() + config.slotDurationMinutes * 60_000);

  try {
    const interview = await assignInterviewers(
      da.application.applicationCycleId,
      da.id,
      [da.challengeVersion.domainId],
      slotStart,
      slotEnd,
    );
    return Response.json(interview, { status: 201 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 409 });
  }
}
