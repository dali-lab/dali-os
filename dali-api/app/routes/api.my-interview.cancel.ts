import type { Route } from "./+types/api.my-interview.cancel";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { deprovisionZoomMeeting } from "~/lib/zoom";

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const { domainApplicationId } = body;

  if (!domainApplicationId) {
    return withCors(request, Response.json({ error: "domainApplicationId is required" }, { status: 400 }));
  }

  const interview = await prisma.interview.findFirst({
    where: {
      domainApplicationId,
      domainApplication: { application: { userId: auth.user.sub } },
      status: "Scheduled",
    },
  });

  if (!interview) {
    return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
  }

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: interview.applicationCycleId },
  });
  const cancelNoticeHours = config?.cancelNoticeHours ?? 0;
  if (cancelNoticeHours > 0) {
    const cutoff = new Date(interview.startTime.getTime() - cancelNoticeHours * 60 * 60_000);
    if (new Date() > cutoff) {
      return withCors(request, Response.json(
        { error: "Too late to cancel — please contact the DALI team" },
        { status: 403 },
      ));
    }
  }

  const updated = await prisma.interview.update({
    where: { id: interview.id },
    data: { status: "CancelledByApplicant" },
  });

  try { await deprovisionZoomMeeting(interview); }
  catch (err) { console.error("Failed to delete Zoom meeting on cancel:", err); }

  return withCors(request, Response.json(updated));
}
