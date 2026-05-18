import { prisma } from "~/lib/db";
import {
  createScheduledMeeting,
  updateScheduledMeetingParticipants,
} from "~/lib/scheduled-meeting";
import { approvedApplicantIds } from "./capacity";

// Sync calendar events to match the current Approved roster. Called from
// the decisions module (post-transaction) and from session-create endpoints.
// Each EducationSession gets at most one ScheduledMeeting; we create it
// lazily on first sync and patch participants thereafter.
//
// "Future sessions only" — past sessions don't get touched. Re-syncing the
// whole offering on every roster change is fine at lab scale (handful of
// sessions per offering).

const SESSION_DURATION_MINUTES = 60;

interface SyncResult {
  meetingsCreated: number;
  meetingsUpdated: number;
  gcalErrors: string[];
}

export async function syncSessionRoster(offeringId: string): Promise<SyncResult> {
  const result: SyncResult = {
    meetingsCreated: 0,
    meetingsUpdated: 0,
    gcalErrors: [],
  };

  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      title: true,
      calendarEmail: true,
      instructors: {
        select: { userId: true },
        orderBy: { id: "asc" },
        take: 1,
      },
    },
  });
  if (!offering) return result;

  const primaryInstructor = offering.instructors[0];
  if (!primaryInstructor) return result;

  const now = new Date();
  const sessions = await prisma.educationSession.findMany({
    where: { offeringId, datetime: { gte: now } },
    orderBy: { datetime: "asc" },
    select: {
      id: true,
      datetime: true,
      scheduledMeetingId: true,
    },
  });
  if (sessions.length === 0) return result;

  const approved = await approvedApplicantIds(offeringId);
  const organizerEmail = offering.calendarEmail ?? null;

  let resolvedOrganizerEmail = organizerEmail;
  let organizerCalendarLinkId: string | null = null;
  if (!resolvedOrganizerEmail) {
    const organizerUser = await prisma.user.findUnique({
      where: { id: primaryInstructor.userId },
      select: { daliEmail: true, dartmouthEmail: true },
    });
    resolvedOrganizerEmail =
      organizerUser?.daliEmail ?? organizerUser?.dartmouthEmail ?? null;
  }
  // If the instructor has a linked Google calendar, use it so Google sends
  // the invites. Otherwise we still create the meeting row + notifications.
  const link = await prisma.userCalendarLink.findFirst({
    where: { userId: primaryInstructor.userId, enabled: true },
    select: { id: true },
  });
  organizerCalendarLinkId = link?.id ?? null;

  if (!resolvedOrganizerEmail) {
    // Can't create a ScheduledMeeting without an organizer email. Skip
    // calendar push entirely; in-app notifications still fire through emit.
    return result;
  }

  for (const session of sessions) {
    if (!session.scheduledMeetingId) {
      const created = await createScheduledMeeting({
        organizerId: primaryInstructor.userId,
        organizerEmail: resolvedOrganizerEmail,
        title: offering.title,
        durationMinutes: SESSION_DURATION_MINUTES,
        scope: { type: "UserList", participantUserIds: approved },
        startTime: session.datetime.toISOString(),
        organizerCalendarLinkId,
      });
      if (created.ok) {
        await prisma.educationSession.update({
          where: { id: session.id },
          data: { scheduledMeetingId: created.meeting.id },
        });
        result.meetingsCreated += 1;
        if (created.gcalError) result.gcalErrors.push(created.gcalError);
      } else {
        result.gcalErrors.push(created.error);
      }
    } else {
      const updated = await updateScheduledMeetingParticipants(
        session.scheduledMeetingId,
        approved,
      );
      if (updated.ok) {
        if (updated.added.length > 0 || updated.removed.length > 0) {
          result.meetingsUpdated += 1;
        }
        if (updated.gcalError) result.gcalErrors.push(updated.gcalError);
      } else {
        result.gcalErrors.push(updated.error);
      }
    }
  }

  return result;
}
