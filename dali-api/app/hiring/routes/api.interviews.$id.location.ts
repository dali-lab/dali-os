import type { Route } from "./+types/api.interviews.$id.location";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
// import { provisionZoomMeeting, deprovisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet

const VALID_LOCATIONS = ["PodAppa", "PodMomo", "Online"] as const;

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { location, meetingUrl } = body;

  if (!location || !VALID_LOCATIONS.includes(location)) {
    return Response.json(
      { error: `location must be one of: ${VALID_LOCATIONS.join(", ")}` },
      { status: 400 },
    );
  }

  if (meetingUrl !== undefined && typeof meetingUrl !== "string") {
    return Response.json({ error: "meetingUrl must be a string" }, { status: 400 });
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

      // Clear meeting URL when switching to in-person; allow setting it for Online
      const zoomJoinUrl = location === "Online"
        ? (meetingUrl !== undefined ? (meetingUrl || null) : interview.zoomJoinUrl)
        : null;

      return tx.interview.update({
        where: { id: params.id },
        data: { location, zoomJoinUrl, zoomMeetingId: location !== "Online" ? null : interview.zoomMeetingId },
      });
    }, { isolationLevel: "Serializable" });

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
