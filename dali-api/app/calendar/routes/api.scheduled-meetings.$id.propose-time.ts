import type { Route } from "./+types/api.scheduled-meetings.$id.propose-time";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { notify } from "~/lib/notify.server";
import { fullName } from "~/lib/display";

const Schema = z.object({
  proposedStart: z.string().datetime(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  const meetingId = params.id!;
  const actorId = auth.user.sub;

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      organizerId: true,
      participantUserIds: true,
      title: true,
      status: true,
    },
  });

  if (!meeting) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (meeting.status === "Cancelled") {
    return withCors(request, Response.json({ error: "This meeting has been cancelled" }, { status: 400 }));
  }
  if (meeting.organizerId === actorId) {
    return withCors(request, Response.json({ error: "Organizers cannot propose a new time for their own meeting" }, { status: 400 }));
  }
  if (!meeting.participantUserIds.includes(actorId)) {
    return withCors(request, Response.json({ error: "You are not invited to this meeting" }, { status: 403 }));
  }

  await prisma.meetingTimeProposal.create({
    data: {
      scheduledMeetingId: meetingId,
      proposedByUserId: actorId,
      proposedStart: new Date(body.proposedStart),
      status: "Pending",
    },
  });

  const proposer = await prisma.user.findUnique({
    where: { id: actorId },
    select: { firstName: true, lastName: true },
  });
  const proposerName = proposer ? fullName(proposer) : "Someone";

  await notify({
    eventType: "meeting.time_proposed",
    createdByUserId: actorId,
    message: {
      title: `${proposerName} proposed a new time for ${meeting.title}`,
      link: `/calendar/meeting/${meetingId}`,
      scheduledMeetingId: meetingId,
    },
    recipients: [{ userId: meeting.organizerId }],
  });

  return withCors(request, Response.json({ ok: true }));
}
