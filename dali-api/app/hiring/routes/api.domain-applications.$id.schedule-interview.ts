import type { Route } from "./+types/api.domain-applications.$id.schedule-interview";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { assignInterviewers } from "~/hiring/lib/scheduling";
// import { provisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet
import { provisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { parseJson } from "~/lib/validate";
import { sendInterviewInviteEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewAssigned } from "~/hiring/lib/interview-notifications";
import { invitedRoundId } from "~/hiring/lib/interview-rounds.server";

const ScheduleInterviewSchema = z.object({
  startTime: z.string().datetime({ offset: true }),
  mode: z.enum(["in-person", "online"]).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, ScheduleInterviewSchema);
  if (body instanceof Response) return body;
  const { startTime, mode } = body;
  const interviewMode = mode === "in-person" ? "in-person" as const : "online" as const;

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      application: true,
      // Scheduled rows block any booking; a Completed one only blocks
      // booking the same round again.
      interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
    },
  });

  if (!da) {
    return Response.json({ error: "Domain application not found" }, { status: 404 });
  }

  if (da.application.userId !== auth.user.sub) {
    return Response.json({ error: "Not your application" }, { status: 403 });
  }

  const roundId = await invitedRoundId(da.id);
  if (!roundId) {
    return Response.json({ error: "Not invited to interview" }, { status: 403 });
  }

  if (da.interviews.some((i) => i.status === "Scheduled" || i.interviewRoundId === roundId)) {
    return Response.json({ error: "Interview already scheduled" }, { status: 409 });
  }

  // DomainApplications always have a domainId on Standard cycles. Fellowship
  // cycles don't run interviews, so reaching this route with a null domainId
  // means something is misconfigured.
  if (!da.domainId) {
    return Response.json({ error: "Domain application is not attached to a domain" }, { status: 400 });
  }

  const config = await prisma.interviewConfig.findUnique({
    where: {
      applicationCycleId_interviewRoundId: {
        applicationCycleId: da.application.applicationCycleId,
        interviewRoundId: roundId,
      },
    },
  });
  if (!config) {
    return Response.json({ error: "No interview config for this round" }, { status: 400 });
  }

  const slotStart = new Date(startTime);
  const slotEnd = new Date(slotStart.getTime() + config.slotDurationMinutes * 60_000);

  const earliestBookable = new Date(Date.now() + config.bookingNoticeHours * 60 * 60_000);
  if (slotStart < earliestBookable) {
    return Response.json(
      { error: `Interviews must be booked at least ${config.bookingNoticeHours} hours in advance` },
      { status: 409 },
    );
  }

  try {
    const interview = await assignInterviewers(
      da.application.applicationCycleId,
      roundId,
      da.id,
      [da.domainId],
      slotStart,
      slotEnd,
      undefined,
      interviewMode,
    );

    // Mint a Google Meet link on the shared hiring calendar for online
    // interviews, awaited so the invite emails below re-read the row and carry
    // the join link. Best-effort (never blocks booking). The Zoom S2S path
    // (app/lib/zoom.ts) stays dormant until those credentials land.
    await provisionInterviewMeet(interview.id);

    await logAuditEvent({
      action: "interview.schedule",
      userId: auth.user.sub,
      targetId: interview.id,
      metadata: {
        cycleId: da.application.applicationCycleId,
        domainApplicationId: da.id,
        startTime: slotStart.toISOString(),
        mode: interviewMode,
        interviewRoundId: roundId,
      },
      request,
    });

    // Best-effort: send calendar invites to applicant + interviewers
    sendInterviewInviteEmails(interview.id, da.id).catch(() => {});
    notifyInterviewAssigned({
      assignmentIds: (interview.assignments ?? []).map((a) => a.id),
    }).catch(() => {});

    return Response.json(interview, { status: 201 });
  } catch (err: any) {
    // Two bookings racing past the app-side check above: the partial unique
    // index Interview_activeDomainApplication_key stops the second one.
    if (err?.code === "P2002") {
      return Response.json({ error: "Interview already scheduled" }, { status: 409 });
    }
    return Response.json({ error: err.message }, { status: 409 });
  }
}
