import type { Route } from "./+types/api.interviews.$id.location";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { provisionZoomMeeting, deprovisionZoomMeeting } from "~/lib/zoom";

const VALID_LOCATIONS = ["PodAppa", "PodMomo", "Online"] as const;

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { location } = body;

  if (!location || !VALID_LOCATIONS.includes(location)) {
    return Response.json(
      { error: `location must be one of: ${VALID_LOCATIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const interview = await prisma.interview.findUnique({
    where: { id: params.id },
  });

  if (!interview) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }

  if (!(await hasCycleAccess(auth.user.sub, interview.applicationCycleId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (interview.status !== "Scheduled") {
    return Response.json(
      { error: "Can only change location of scheduled interviews" },
      { status: 400 },
    );
  }

  // Conflict check + update in one serializable transaction to prevent
  // two concurrent location changes from both passing the overlap check.
  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (location === "PodAppa" || location === "PodMomo") {
        const conflict = await tx.interview.findFirst({
          where: {
            id: { not: interview.id },
            applicationCycleId: interview.applicationCycleId,
            status: "Scheduled",
            location,
            startTime: { lt: interview.endTime },
            endTime: { gt: interview.startTime },
          },
        });

        if (conflict) {
          throw new Error("__POD_OCCUPIED__");
        }
      }

      return tx.interview.update({
        where: { id: params.id },
        data: { location },
      });
    }, { isolationLevel: "Serializable" });

    // Handle Zoom provisioning/deprovisioning on location transitions
    const wasOnline = interview.location === "Online";
    const isNowOnline = location === "Online";
    if (!wasOnline && isNowOnline) {
      try {
        const config = await prisma.interviewConfig.findUnique({ where: { applicationCycleId: interview.applicationCycleId } });
        await provisionZoomMeeting(interview.id, "DALI Lab Interview", interview.startTime, config?.slotDurationMinutes ?? 30);
      } catch (err) { console.error("Failed to provision Zoom meeting on location change:", err); }
    } else if (wasOnline && !isNowOnline) {
      try {
        await deprovisionZoomMeeting(interview);
        await prisma.interview.update({ where: { id: interview.id }, data: { zoomMeetingId: null, zoomJoinUrl: null } });
      } catch (err) { console.error("Failed to delete Zoom meeting on location change:", err); }
    }

    return Response.json(updated);
  } catch (err: any) {
    if (err?.message === "__POD_OCCUPIED__") {
      return Response.json(
        { error: `${location === "PodAppa" ? "Pod Appa" : "Pod Momo"} is already occupied at this time` },
        { status: 409 },
      );
    }
    throw err;
  }
}
