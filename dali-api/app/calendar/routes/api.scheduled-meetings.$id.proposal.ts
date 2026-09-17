import type { Route } from "./+types/api.scheduled-meetings.$id.proposal";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { isCore } from "~/lib/roles";
import { updateScheduledMeeting, type ScheduledMeetingScope } from "~/lib/scheduled-meeting";
import { notify } from "~/lib/notify.server";

const Schema = z.object({
  action: z.enum(["accept", "decline"]),
  proposalId: z.string().min(1),
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

  const proposal = await prisma.meetingTimeProposal.findUnique({
    where: { id: body.proposalId },
    select: {
      id: true,
      scheduledMeetingId: true,
      proposedByUserId: true,
      proposedStart: true,
      status: true,
    },
  });

  if (!proposal || proposal.scheduledMeetingId !== meetingId) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (proposal.status !== "Pending") {
    return withCors(request, Response.json({ error: "This proposal has already been resolved" }, { status: 400 }));
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      durationMinutes: true,
      scopeType: true,
      scopeId: true,
      participantUserIds: true,
      organizerId: true,
    },
  });

  if (!meeting) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const core = await isCore(actorId);
  if (meeting.organizerId !== actorId && !core) {
    return forbidden(request);
  }

  if (body.action === "decline") {
    await prisma.meetingTimeProposal.update({
      where: { id: proposal.id },
      data: { status: "Declined" },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // accept: rebuild scope then reschedule
  let scope: ScheduledMeetingScope;
  if (meeting.scopeType === "Group" && meeting.scopeId) {
    scope = { type: "Group", groupId: meeting.scopeId };
  } else if (meeting.scopeType === "UserList") {
    scope = { type: "UserList", participantUserIds: meeting.participantUserIds };
  } else {
    scope = { type: "None" };
  }

  const result = await updateScheduledMeeting(meetingId, actorId, {
    title: meeting.title,
    durationMinutes: meeting.durationMinutes,
    scope,
    startTime: proposal.proposedStart.toISOString(),
    editScope: "all",
  });

  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }

  await Promise.all([
    prisma.meetingTimeProposal.update({
      where: { id: proposal.id },
      data: { status: "Accepted" },
    }),
    prisma.meetingTimeProposal.updateMany({
      where: {
        scheduledMeetingId: meetingId,
        status: "Pending",
        id: { not: proposal.id },
      },
      data: { status: "Declined" },
    }),
  ]);

  try {
    await notify({
      eventType: "meeting.invite",
      createdByUserId: actorId,
      message: {
        title: `Your proposed time was accepted for ${meeting.title}`,
        link: "/calendar",
        scheduledMeetingId: meetingId,
      },
      recipients: [{ userId: proposal.proposedByUserId }],
    });
  } catch (err) {
    console.error(`proposal accept: notify proposer failed`, err);
  }

  return withCors(request, Response.json({ ok: true, gcalError: result.gcalError }));
}
