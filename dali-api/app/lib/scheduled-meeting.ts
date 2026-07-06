// Shared helper for creating a ScheduledMeeting. Called by the web API
// (app/calendar/routes/api.scheduled-meetings.ts) and the MCP schedule_meeting
// tool. Handles scope resolution, optional Google Calendar push, and
// participant notification fan-out.

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { createGoogleCalendarEvent, type GoogleAttendee } from "~/lib/google-calendar";
import { primaryEmail } from "~/lib/display";
import type { ScheduledMeeting } from "~/generated/prisma/client";

export type ScheduledMeetingScope =
  | { type: "None" }
  | { type: "Group"; groupId: string }
  | { type: "UserList"; participantUserIds: string[] };

export type CreateScheduledMeetingInput = {
  organizerId: string;
  organizerEmail: string;
  title: string;
  durationMinutes: number;
  scope: ScheduledMeetingScope;
  startTime?: string | null;
  recurrenceRule?: string | null;
  organizerCalendarLinkId?: string | null;
};

export type CreateScheduledMeetingResult =
  | {
      ok: true;
      meeting: ScheduledMeeting & { externalEventId: string | null };
      notifiedCount: number;
      gcalError: string | null;
    }
  | { ok: false; error: string };

export async function createScheduledMeeting(
  input: CreateScheduledMeetingInput,
): Promise<CreateScheduledMeetingResult> {
  let participantUserIds: string[] = [];
  let scopeId: string | null = null;
  if (input.scope.type === "Group") {
    participantUserIds = await resolveGroupMembers(input.scope.groupId);
    scopeId = input.scope.groupId;
  } else if (input.scope.type === "UserList") {
    participantUserIds = Array.from(new Set(input.scope.participantUserIds));
  }

  const startDate = input.startTime ? new Date(input.startTime) : null;

  let organizerLink: {
    id: string;
    userId: string;
    externalEmail: string;
    enabled: boolean;
  } | null = null;
  if (input.organizerCalendarLinkId) {
    organizerLink = await prisma.userCalendarLink.findUnique({
      where: { id: input.organizerCalendarLinkId },
      select: { id: true, userId: true, externalEmail: true, enabled: true },
    });
    if (!organizerLink || organizerLink.userId !== input.organizerId) {
      return { ok: false, error: "Invalid calendar link" };
    }
  }

  const meeting = await prisma.scheduledMeeting.create({
    data: {
      organizerId: input.organizerId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      scopeType: input.scope.type,
      scopeId,
      participantUserIds,
      recurrenceRule: input.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ownerCalendarEmail: organizerLink?.externalEmail ?? input.organizerEmail,
      organizerCalendarLinkId: organizerLink?.id ?? null,
    },
  });

  let externalEventId: string | null = null;
  let gcalError: string | null = null;
  if (organizerLink && organizerLink.enabled && startDate && participantUserIds.length > 0) {
    const attendeeUsers = await prisma.user.findMany({
      where: { id: { in: participantUserIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
      },
    });
    const attendees: GoogleAttendee[] = [];
    for (const u of attendeeUsers) {
      const email = primaryEmail(u);
      if (!email) continue;
      attendees.push({
        email,
        displayName: `${u.firstName} ${u.lastName}`.trim() || email,
      });
    }
    if (attendees.length > 0) {
      const endDate = new Date(startDate.getTime() + input.durationMinutes * 60_000);
      try {
        const result = await createGoogleCalendarEvent({
          linkId: organizerLink.id,
          summary: input.title,
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          recurrenceRule: input.recurrenceRule ?? null,
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

  const notifyIds = participantUserIds.filter((id) => id !== input.organizerId);
  let notifiedCount = 0;
  if (notifyIds.length > 0) {
    const linkUrl = `/calendar?meeting=${meeting.id}`;
    const notifBody = startDate ? `Starts ${startDate.toISOString()}` : null;
    const result = await prisma.notification.createMany({
      data: notifyIds.map((rid) => ({
        recipientUserId: rid,
        createdByUserId: input.organizerId,
        kind: "MeetingInvite" as const,
        title: `Meeting invite: ${input.title}`,
        body: notifBody,
        link: linkUrl,
        sourceGroupId: scopeId,
        scheduledMeetingId: meeting.id,
      })),
    });
    notifiedCount = result.count;
  }

  return {
    ok: true,
    meeting: { ...meeting, externalEventId },
    notifiedCount,
    gcalError,
  };
}

export type CancelScheduledMeetingResult =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; error: string; status: number };

/**
 * Cancel a meeting. Only the organizer may cancel. Flipping the status to
 * Cancelled is all that's needed to pull the invite out of every recipient's
 * todos, tasks, attention banner, and notification bell — those surfaces filter
 * on `scheduledMeeting.status !== "Cancelled"` rather than fanning out deletes.
 * The Google Calendar event (if any) is left in place; deleting it would need a
 * new google-calendar helper and is out of scope here.
 */
export async function cancelScheduledMeeting(
  meetingId: string,
  actorUserId: string,
): Promise<CancelScheduledMeetingResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { id: true, organizerId: true, status: true },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  if (meeting.organizerId !== actorUserId) {
    return { ok: false, error: "Only the organizer can cancel", status: 403 };
  }
  if (meeting.status === "Cancelled") return { ok: true, alreadyCancelled: true };

  await prisma.scheduledMeeting.update({
    where: { id: meetingId },
    data: { status: "Cancelled" },
  });
  return { ok: true, alreadyCancelled: false };
}
