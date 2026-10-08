import type { Route } from "./+types/api.interviews.$id.location";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
// import { provisionZoomMeeting, deprovisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet
import { provisionInterviewMeet, deprovisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { sendLocationChangeEmails } from "~/hiring/lib/interview-emails";
import { createRoomBooking } from "~/lib/rooms.server";
import { releaseInterviewRoom } from "~/hiring/lib/scheduling";

const LocationSchema = z.object({ roomId: z.string().nullable() });

class LocationChangeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, LocationSchema);
  if (body instanceof Response) return body;
  const { roomId } = body;

  const interview = await prisma.interview.findUnique({
    where: { id: params.id },
    include: { roomBooking: { select: { userId: true } } },
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

  // Conflict check + update in one serializable transaction to prevent two
  // concurrent location changes from both passing the room-availability check.
  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (roomId) {
        const room = await tx.room.findUnique({
          where: { id: roomId },
          select: { id: true, archivedAt: true },
        });
        if (!room || room.archivedAt) {
          throw new LocationChangeError("Room not found", 404);
        }
        const inCycle = await tx.interviewConfig.findFirst({
          where: { applicationCycleId: interview.applicationCycleId, rooms: { some: { id: roomId } } },
          select: { id: true },
        });
        if (!inCycle) {
          throw new LocationChangeError("Room is not set up for this cycle", 400);
        }
      }

      await releaseInterviewRoom(interview, tx);

      let roomBookingId: string | null = null;
      if (roomId) {
        const assignment = await tx.interviewAssignment.findFirst({
          where: { interviewId: interview.id, role: "InDomain", status: "Active" },
          select: { cycleInterviewer: { select: { userId: true } } },
        });
        if (!assignment) {
          throw new LocationChangeError("No active in-domain interviewer on this interview", 400);
        }
        const booked = await createRoomBooking(
          {
            roomId,
            userId: assignment.cycleInterviewer.userId,
            start: interview.startTime,
            end: interview.endTime,
            title: "Interview",
            source: "Interview",
            applicationCycleId: interview.applicationCycleId,
          },
          tx,
        );
        if (!booked.ok) throw new LocationChangeError(booked.error, booked.status);
        roomBookingId = booked.value.id;
      }

      return tx.interview.update({
        where: { id: interview.id },
        data: { roomId, roomBookingId },
      });
    }, { isolationLevel: "Serializable" });

    // Provision or tear down the Google Meet link to match the new location,
    // then re-read so the response (and the location-change email) carry the
    // current join link. Both calls are best-effort no-ops when Meet is off.
    if (roomId === null) {
      await provisionInterviewMeet(interview.id);
    } else {
      await deprovisionInterviewMeet({ id: interview.id, calendarEventId: interview.calendarEventId });
    }
    const fresh = await prisma.interview.findUnique({
      where: { id: params.id },
      include: { room: { select: { id: true, name: true } } },
    });

    // Best-effort: notify applicant + interviewers of location change
    sendLocationChangeEmails(interview.id, interview.domainApplicationId).catch(() => {});

    return Response.json(fresh ?? updated);
  } catch (err) {
    if (err instanceof LocationChangeError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
