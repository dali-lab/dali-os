// Shared helper for creating a ScheduledMeeting. Called by the web API
// (app/calendar/routes/api.scheduled-meetings.ts) and the MCP schedule_meeting
// tool. Handles scope resolution, optional Google Calendar push, and
// participant notification fan-out.

import { randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers } from "~/lib/groups";
import { createGoogleCalendarEvent, type GoogleAttendee } from "~/lib/google-calendar";
import { primaryEmail, formatDateShort } from "~/lib/display";
import { buildIcs } from "~/lib/ics";
import { createProjectPage, createLabMeetingPage, ensureMeetingNotesFolder } from "~/lib/pages";
import { isCore } from "~/lib/roles";
import type { ScheduledMeeting, MeetingType, AttendanceMode } from "~/generated/prisma/client";

function meetingUid(meetingId: string): string {
  return `meeting-${meetingId}@dali.dartmouth.edu`;
}

// Invites go out with SEQUENCE:0 and cancels with SEQUENCE:1 — meetings have
// no intermediate ICS updates, so a persistent counter (interviews'
// icsSequence) isn't needed.
const ICS_SEQ_INVITE = 0;
const ICS_SEQ_CANCEL = 1;

// One ICS per recipient, listing only that recipient as attendee (same
// pattern as the applicant's interview ICS: nobody sees the full guest list).
async function buildPerRecipientIcs(args: {
  meetingId: string;
  method: "REQUEST" | "CANCEL";
  title: string;
  startTime: Date;
  durationMinutes: number;
  organizerEmail: string;
  recurrenceRule: string | null;
  userIds: string[];
}): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: args.userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  const endTime = new Date(args.startTime.getTime() + args.durationMinutes * 60_000);
  const byUser = new Map<string, string>();
  for (const u of users) {
    const email = primaryEmail(u);
    if (!email) continue;
    byUser.set(
      u.id,
      buildIcs({
        uid: meetingUid(args.meetingId),
        method: args.method,
        summary: args.title,
        startTime: args.startTime,
        endTime,
        organizer: { email: args.organizerEmail, name: "DALI OS" },
        attendees: [{ email, name: `${u.firstName} ${u.lastName}`.trim() || email }],
        sequence: args.method === "CANCEL" ? ICS_SEQ_CANCEL : ICS_SEQ_INVITE,
        recurrenceRule: args.recurrenceRule,
      }),
    );
  }
  return byUser;
}

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
  // Meeting-note fields. When both are set, a "<label> meeting note (<date>)"
  // Page is auto-created under the project's shared documents, and a
  // MeetingAttendance row is fanned out per participant (including the
  // organizer). meetingTypeLabel supplies the note's display label — required
  // when meetingType is "Other", ignored otherwise (Team/Partner have fixed
  // labels).
  meetingType?: MeetingType | null;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
  // Roster (default): organizer/Core check attendees off by hand (needs a
  // meeting note for the checklist UI). SelfCheckIn: a checkInToken is
  // generated and attendees mark themselves present via the check-in route —
  // works with or without a meeting note (QR lives on the note when present,
  // otherwise on /calendar/check-in/:id).
  attendanceMode?: AttendanceMode;
};

export type CreateScheduledMeetingResult =
  | {
      ok: true;
      meeting: ScheduledMeeting & { externalEventId: string | null };
      notifiedCount: number;
      gcalError: string | null;
      notePageId: string | null;
      checkInToken: string | null;
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

  const attendanceMode = input.attendanceMode ?? "Roster";
  const checkInToken = attendanceMode === "SelfCheckIn" ? randomBytes(24).toString("base64url") : null;

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
      meetingType: input.meetingType ?? null,
      meetingTypeLabel: input.meetingType === "Other" ? (input.meetingTypeLabel ?? null) : null,
      projectId: input.meetingType ? (input.projectId ?? null) : null,
      attendanceMode,
      checkInToken,
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

  // Note-page creation is optional (driven by meetingType). Attendance rows
  // fan out for notes (roster checklist) and for SelfCheckIn (QR / self-serve
  // present) — either alone or together. Scope is always the meeting's
  // participants (+ organizer), never the whole lab.
  let notePageId: string | null = null;
  if (input.meetingType) {
    // Auto-generated note pages are titled with just the meeting date — the
    // note already lives under its Team/Partner folder (or carries its custom
    // "Other" label via the meeting itself), so repeating "… meeting note" in
    // the title is redundant.
    const noteDate = startDate ?? new Date();
    const title = formatDateShort(noteDate);

    if (input.projectId) {
      // Team/Partner notes nest under their default, undeletable folder;
      // "Other" notes stay top-level (no default folder for a custom label).
      let parentPageId: string | null = null;
      if (input.meetingType === "Team" || input.meetingType === "Partner") {
        const folder = await ensureMeetingNotesFolder(
          input.projectId,
          input.meetingType,
          input.organizerId,
        );
        parentPageId = folder.id;
      }
      const page = await createProjectPage({
        projectId: input.projectId,
        title,
        createdById: input.organizerId,
        meetingNoteId: meeting.id,
        parentPageId,
      });
      notePageId = page.id;
    } else {
      const page = await createLabMeetingPage({
        title,
        createdById: input.organizerId,
        meetingNoteId: meeting.id,
      });
      notePageId = page.id;
    }
  }

  if (input.meetingType || attendanceMode === "SelfCheckIn") {
    const attendeeIds = Array.from(new Set([...participantUserIds, input.organizerId]));
    await prisma.meetingAttendance.createMany({
      data: attendeeIds.map((userId) => ({
        scheduledMeetingId: meeting.id,
        userId,
      })),
    });
  }

  const notifyIds = participantUserIds.filter((id) => id !== input.organizerId);
  let notifiedCount = 0;
  if (notifyIds.length > 0) {
    // Attach a calendar invite on the instant-email channel — but only when
    // Google Calendar isn't already sending real invites for this meeting.
    const icsByUser =
      startDate && !externalEventId
        ? await buildPerRecipientIcs({
            meetingId: meeting.id,
            method: "REQUEST",
            title: input.title,
            startTime: startDate,
            durationMinutes: input.durationMinutes,
            organizerEmail: meeting.ownerCalendarEmail,
            recurrenceRule: input.recurrenceRule ?? null,
            userIds: notifyIds,
          })
        : null;
    const result = await notify({
      eventType: "meeting.invite",
      createdByUserId: input.organizerId,
      message: {
        title: `Meeting invite: ${input.title}`,
        body: startDate ? `Starts ${startDate.toISOString()}` : null,
        link: `/calendar?meeting=${meeting.id}`,
        sourceGroupId: scopeId,
        scheduledMeetingId: meeting.id,
      },
      recipients: notifyIds.map((userId) => ({
        userId,
        ics: icsByUser?.get(userId) ?? null,
      })),
    });
    notifiedCount = result.inApp;
  }

  return {
    ok: true,
    meeting: { ...meeting, externalEventId },
    notifiedCount,
    gcalError,
    notePageId,
    checkInToken,
  };
}

export type MarkMeetingAttendanceResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Toggle whether a participant was present at a meeting, keeping TimeEntry in
 * sync: present -> upsert a Meeting-sourced TimeEntry for that user; not
 * present -> delete it. Shared by the organizer-facing attendance-toggle
 * route (api.scheduled-meetings.$id.attendance.ts) and the self-check-in
 * route (api.scheduled-meetings.$id.check-in.ts) so the upsert/delete logic
 * isn't duplicated between "someone else marks you present" and "you mark
 * yourself present." Callers are responsible for their own auth/permission
 * gate before calling this — it does not re-check who `markedByUserId` is.
 */
export async function markMeetingAttendance(
  meetingId: string,
  userId: string,
  present: boolean,
  markedByUserId: string,
): Promise<MarkMeetingAttendanceResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { id: true, projectId: true, durationMinutes: true, selectedAt: true, createdAt: true },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };

  const attendance = await prisma.meetingAttendance.findUnique({
    where: { scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId } },
  });
  if (!attendance) {
    return { ok: false, error: "User was not invited to this meeting", status: 400 };
  }

  await prisma.meetingAttendance.update({
    where: { scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId } },
    data: { present, markedByUserId, markedAt: new Date() },
  });

  if (present) {
    const startTime = meeting.selectedAt;
    const endTime = startTime
      ? new Date(startTime.getTime() + meeting.durationMinutes * 60_000)
      : null;
    await prisma.timeEntry.upsert({
      where: {
        scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId },
      },
      create: {
        userId,
        source: "Meeting",
        scheduledMeetingId: meeting.id,
        projectId: meeting.projectId,
        date: startTime ?? meeting.createdAt,
        hours: meeting.durationMinutes / 60,
        startTime,
        endTime,
      },
      update: {
        projectId: meeting.projectId,
        date: startTime ?? meeting.createdAt,
        hours: meeting.durationMinutes / 60,
        startTime,
        endTime,
      },
    });
  } else {
    await prisma.timeEntry.deleteMany({
      where: { scheduledMeetingId: meeting.id, userId },
    });
  }

  return { ok: true };
}

export type CancelScheduledMeetingResult =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; error: string; status: number };

/**
 * Cancel a meeting. The organizer may cancel; Core can also cancel (used by
 * Admin → Attendance to remove a self-check-in event from the list). Flipping
 * the status to Cancelled is all that's needed to pull the invite out of every
 * recipient's todos, tasks, attention banner, and notification bell — those
 * surfaces filter on `scheduledMeeting.status !== "Cancelled"` rather than
 * fanning out deletes. The Google Calendar event (if any) is left in place;
 * deleting it would need a new google-calendar helper and is out of scope here.
 */
export async function cancelScheduledMeeting(
  meetingId: string,
  actorUserId: string,
  opts?: { allowCore?: boolean },
): Promise<CancelScheduledMeetingResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      organizerId: true,
      status: true,
      title: true,
      participantUserIds: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      ownerCalendarEmail: true,
      externalEventId: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  if (meeting.organizerId !== actorUserId) {
    if (!opts?.allowCore || !(await isCore(actorUserId))) {
      return { ok: false, error: "Only the organizer can cancel", status: 403 };
    }
  }
  if (meeting.status === "Cancelled") return { ok: true, alreadyCancelled: true };

  await prisma.scheduledMeeting.update({
    where: { id: meetingId },
    data: { status: "Cancelled" },
  });

  // Tell everyone who was invited. Deliberately NOT stamped with
  // scheduledMeetingId — surfaces hide rows whose meeting is Cancelled, which
  // would make this very notification invisible. Best-effort: the cancel
  // already happened, a delivery hiccup shouldn't fail the request.
  const recipients = (meeting.participantUserIds ?? []).filter(
    (id) => id !== actorUserId,
  );
  if (recipients.length > 0) {
    try {
      // A METHOD:CANCEL ICS (same UID as the invite) removes the event from
      // recipients' calendars — only where we sent the invite ICS ourselves,
      // i.e. not for Google-managed events.
      const icsByUser =
        meeting.selectedAt && !meeting.externalEventId
          ? await buildPerRecipientIcs({
              meetingId: meeting.id,
              method: "CANCEL",
              title: meeting.title,
              startTime: meeting.selectedAt,
              durationMinutes: meeting.durationMinutes,
              organizerEmail: meeting.ownerCalendarEmail,
              recurrenceRule: meeting.recurrenceRule,
              userIds: recipients,
            })
          : null;
      await notify({
        eventType: "meeting.cancelled",
        createdByUserId: actorUserId,
        message: {
          title: `Meeting cancelled: ${meeting.title}`,
          link: "/calendar",
        },
        recipients: recipients.map((userId) => ({
          userId,
          ics: icsByUser?.get(userId) ?? null,
        })),
      });
    } catch (err) {
      console.error(`meeting ${meetingId}: cancellation notify failed`, err);
    }
  }
  return { ok: true, alreadyCancelled: false };
}
