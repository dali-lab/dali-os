import type { Route } from "./+types/api.scheduled-meetings";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { resolveGroupMembers } from "~/lib/groups";
import { createGoogleCalendarEvent, type GoogleAttendee } from "~/lib/google-calendar";

const Base = {
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(480),
  recurrenceRule: z.string().max(500).optional(),
  startTime: z.string().datetime().optional(),
  organizerCalendarLinkId: z.string().min(1).optional(),
} as const;

const CreateSchema = z.discriminatedUnion("scopeType", [
  z.object({ scopeType: z.literal("None"), ...Base }),
  z.object({ scopeType: z.literal("Group"), groupId: z.string().min(1), ...Base }),
  z.object({
    scopeType: z.literal("UserList"),
    participantUserIds: z.array(z.string().min(1)).min(1),
    ...Base,
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant")
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return withCors(request, body);

  // Resolve participants by scope.
  let participantUserIds: string[] = [];
  let scopeId: string | null = null;
  if (body.scopeType === "Group") {
    participantUserIds = await resolveGroupMembers(body.groupId);
    scopeId = body.groupId;
  } else if (body.scopeType === "UserList") {
    participantUserIds = Array.from(new Set(body.participantUserIds));
  }

  const startDate = body.startTime ? new Date(body.startTime) : null;

  // If the user picked a linked Google calendar, validate ownership before
  // we trust it as the invite source.
  let organizerLink: { id: string; userId: string; externalEmail: string; enabled: boolean } | null = null;
  if (body.organizerCalendarLinkId) {
    organizerLink = await prisma.userCalendarLink.findUnique({
      where: { id: body.organizerCalendarLinkId },
      select: { id: true, userId: true, externalEmail: true, enabled: true },
    });
    if (!organizerLink || organizerLink.userId !== auth.user.sub) {
      return withCors(request, Response.json({ error: "Invalid calendar link" }, { status: 400 }));
    }
  }

  const meeting = await prisma.scheduledMeeting.create({
    data: {
      organizerId: auth.user.sub,
      title: body.title,
      durationMinutes: body.durationMinutes,
      scopeType: body.scopeType,
      scopeId,
      participantUserIds,
      recurrenceRule: body.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ownerCalendarEmail: organizerLink?.externalEmail ?? auth.user.email,
      organizerCalendarLinkId: organizerLink?.id ?? null,
    },
  });

  // Push to Google Calendar (and let Google send Gmail invites) when we have
  // a linked calendar, a confirmed start time, and at least one participant.
  let externalEventId: string | null = null;
  let gcalError: string | null = null;
  if (organizerLink && organizerLink.enabled && startDate && participantUserIds.length > 0) {
    // Resolve attendees' email addresses, prefer daliEmail → dartmouthEmail.
    const attendeeUsers = await prisma.user.findMany({
      where: { id: { in: participantUserIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
    });
    const attendees: GoogleAttendee[] = [];
    for (const u of attendeeUsers) {
      const email = u.daliEmail ?? u.dartmouthEmail;
      if (!email) continue;
      attendees.push({
        email,
        displayName: `${u.firstName} ${u.lastName}`.trim() || email,
      });
    }
    if (attendees.length > 0) {
      const endDate = new Date(startDate.getTime() + body.durationMinutes * 60_000);
      try {
        const result = await createGoogleCalendarEvent({
          linkId: organizerLink.id,
          summary: body.title,
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          recurrenceRule: body.recurrenceRule ?? null,
          attendees,
        });
        externalEventId = result.eventId;
        await prisma.scheduledMeeting.update({
          where: { id: meeting.id },
          data: { externalEventId },
        });
      } catch (err) {
        gcalError = err instanceof Error ? err.message : "Google Calendar push failed";
      }
    }
  }

  // Fan-out MeetingInvite notifications to participants (excluding the organizer themself).
  const notifyIds = participantUserIds.filter((id) => id !== auth.user.sub);
  let notifiedCount = 0;
  if (notifyIds.length > 0) {
    const linkUrl = `/calendar?meeting=${meeting.id}`;
    const notifBody = startDate ? `Starts ${startDate.toISOString()}` : null;
    const result = await prisma.notification.createMany({
      data: notifyIds.map((rid) => ({
        recipientUserId: rid,
        createdByUserId: auth.user.sub,
        kind: "MeetingInvite" as const,
        title: `Meeting invite: ${body.title}`,
        body: notifBody,
        link: linkUrl,
        sourceGroupId: scopeId,
        scheduledMeetingId: meeting.id,
      })),
    });
    notifiedCount = result.count;
  }

  return withCors(
      request,
      Response.json(
        {
          ok: true,
          meeting: { ...meeting, externalEventId },
          notifiedCount,
          gcalError,
        },
        { status: 201 },
      ),
    );
}
