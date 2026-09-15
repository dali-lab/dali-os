// Shared helper for creating a ScheduledMeeting. Called by the web API
// (app/calendar/routes/api.scheduled-meetings.ts) and the MCP schedule_meeting
// tool. Handles scope resolution, optional Google Calendar push, and
// participant notification fan-out.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers } from "~/lib/groups";
import { createGoogleCalendarEvent, type GoogleAttendee } from "~/lib/google-calendar";
import { primaryEmail, formatDateShort } from "~/lib/display";
import { resolveUserTimeZone } from "~/lib/timezone";
import { buildIcs } from "~/lib/ics";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotesFolder,
  ensureCoreMeetingNotesFolder,
} from "~/lib/pages";
import { isCore } from "~/lib/roles";
import { expandOccurrences, type OccurrenceException } from "~/lib/meeting-occurrences";
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
  /** A calendar inside that link. Omitted = the account's primary calendar. */
  organizerCalendarId?: string | null;
  // Meeting-note fields. When both are set, a "<label> meeting note (<date>)"
  // Page is auto-created under the project's shared documents, and a
  // MeetingAttendance row is fanned out per participant (including the
  // organizer). meetingTypeLabel supplies the note's display label — required
  // when meetingType is "Other", ignored otherwise (Team/Partner have fixed
  // labels).
  meetingType?: MeetingType | null;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
  // General ("Other") meetings only: where to file the note page. Authorized and
  // resolved by resolveNoteDestination — an unauthorized/invalid location (or an
  // omitted one) falls back to the Lab root. Ignored for Team/Partner, which file
  // into the project's meeting-notes folder.
  noteLocation?: {
    workspaceType: "Lab" | "Project";
    workspaceId: string | null;
    parentPageId: string | null;
  } | null;
  // Roster (default): organizer/Core check attendees off by hand (needs a
  // meeting note for the checklist UI). SelfCheckIn: attendees mark themselves
  // present via the check-in route — works with or without a meeting note (QR
  // lives on the note when present, otherwise on /calendar/check-in/:id).
  attendanceMode?: AttendanceMode;
  // Core marker — see ScheduledMeeting.isCoreMeeting. Callers are responsible
  // for checking the setter is Core; this layer just persists the flag. It also
  // decides where a project-less note is filed: Core's own meeting-notes folder
  // rather than the organizer's chosen `noteLocation`.
  isCoreMeeting?: boolean;
  // Mint a Google Meet link for the meeting. Only takes effect when the meeting
  // is actually pushed to the organizer's linked Google calendar (a start time,
  // participants, and an enabled calendar link) — the link is born on that
  // event and Google's invite carries it. No-op otherwise.
  addMeet?: boolean;
};

export type CreateScheduledMeetingResult =
  | {
      ok: true;
      meeting: ScheduledMeeting & { externalEventId: string | null };
      notifiedCount: number;
      gcalError: string | null;
      notePageId: string | null;
    }
  | { ok: false; error: string };

// Authorize + resolve a General meeting's chosen note location. Mirrors the
// /api/move-destinations eligibility (Lab-wide, plus any project the organizer
// can edit) so a note can only land where the organizer may write. Anything
// unauthorized or malformed quietly falls back to the Lab root.
async function resolveNoteDestination(
  organizerId: string,
  loc: CreateScheduledMeetingInput["noteLocation"],
): Promise<{ workspaceType: "Lab" | "Project"; workspaceId: string | null; parentPageId: string | null }> {
  const labRoot = { workspaceType: "Lab" as const, workspaceId: null, parentPageId: null };
  if (!loc) return labRoot;

  if (loc.workspaceType === "Project") {
    if (!loc.workspaceId) return labRoot;
    const core = await isCore(organizerId);
    const proj = await prisma.project.findFirst({
      where: { id: loc.workspaceId, ...(core ? {} : { assignments: { some: { userId: organizerId } } }) },
      select: { id: true },
    });
    if (!proj) return labRoot;
  }

  // Validate the parent folder (if any) is a live Folder in the target workspace;
  // otherwise drop to that workspace's top level rather than misfiling the note.
  let parentPageId: string | null = null;
  if (loc.parentPageId) {
    const folder = await prisma.page.findUnique({
      where: { id: loc.parentPageId },
      select: { kind: true, archivedAt: true, workspaceType: true, workspaceId: true },
    });
    const wsMatch =
      !!folder &&
      folder.workspaceType === loc.workspaceType &&
      (loc.workspaceType === "Lab" ? folder.workspaceId === null : folder.workspaceId === loc.workspaceId);
    if (folder && folder.kind === "Folder" && !folder.archivedAt && wsMatch) {
      parentPageId = loc.parentPageId;
    }
  }

  return {
    workspaceType: loc.workspaceType,
    workspaceId: loc.workspaceType === "Project" ? loc.workspaceId : null,
    parentPageId,
  };
}

// Create the meeting-note Page for a meeting and return its id. Shared by
// createScheduledMeeting (note requested at creation) and attachMeetingNote
// (note added to an already-created meeting) so the three filing paths —
// project (Team/Partner), Core, and General (chosen Drive location) — live in
// one place. `authorId` is the note's creator and the identity note-destination
// authorization runs against (the organizer at creation, the actor after).
async function buildMeetingNotePage(input: {
  meetingId: string;
  authorId: string;
  meetingType: MeetingType;
  meetingTypeLabel: string | null;
  projectId: string | null;
  isCoreMeeting: boolean;
  noteLocation: CreateScheduledMeetingInput["noteLocation"];
  startDate: Date | null;
}): Promise<string> {
  const noteDate = input.startDate ?? new Date();
  const dateLabel = formatDateShort(noteDate);
  let title = dateLabel;

  if (input.projectId) {
    // Team/Partner notes nest under their default, undeletable folder;
    // "Other" notes stay top-level (no default folder for a custom label).
    let parentPageId: string | null = null;
    if (input.meetingType === "Team" || input.meetingType === "Partner") {
      const folder = await ensureMeetingNotesFolder(
        input.projectId,
        input.meetingType,
        input.authorId,
      );
      parentPageId = folder.id;
      // Team/Partner notes are named for the project and kind they belong
      // to, so they stay identifiable once they leave that folder — in
      // search, in Drive, and on the meeting itself.
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { name: true },
      });
      if (project) {
        title = `${project.name} ${input.meetingType} meeting note (${dateLabel})`;
      }
    }
    const page = await createProjectPage({
      projectId: input.projectId,
      title,
      createdById: input.authorId,
      meetingNoteId: input.meetingId,
      parentPageId,
    });
    return page.id;
  }

  if (input.isCoreMeeting) {
    // A Core meeting's note belongs to Core, the way a project meeting's note
    // belongs to its project: always Core's own meeting-notes folder, never a
    // location the organizer picked. The folder is Core-scoped, so the note is
    // Core-only without depending on its own link access.
    if (input.meetingTypeLabel) title = `${input.meetingTypeLabel} (${dateLabel})`;
    const coreFolderId = await ensureCoreMeetingNotesFolder(input.authorId);
    const page = await createLabMeetingPage({
      title,
      createdById: input.authorId,
      meetingNoteId: input.meetingId,
      // Null only when the Core group isn't seeded yet — the note lands at the
      // Lab root rather than not existing at all.
      parentPageId: coreFolderId,
      restricted: coreFolderId !== null,
    });
    return page.id;
  }

  // General meeting: file the note at the author's chosen Drive location
  // (default/fallback: Lab root). Include the label in the title so the note
  // stays identifiable wherever it lands.
  if (input.meetingTypeLabel) title = `${input.meetingTypeLabel} (${dateLabel})`;
  const dest = await resolveNoteDestination(input.authorId, input.noteLocation);
  if (dest.workspaceType === "Project" && dest.workspaceId) {
    const page = await createProjectPage({
      projectId: dest.workspaceId,
      title,
      createdById: input.authorId,
      meetingNoteId: input.meetingId,
      parentPageId: dest.parentPageId,
    });
    return page.id;
  }
  const page = await createLabMeetingPage({
    title,
    createdById: input.authorId,
    meetingNoteId: input.meetingId,
    parentPageId: dest.parentPageId,
  });
  return page.id;
}

export async function createScheduledMeeting(
  input: CreateScheduledMeetingInput,
): Promise<CreateScheduledMeetingResult> {
  // Hard constraint (defense in depth alongside the route schema): a meeting is
  // either a project meeting (Team/Partner + project) or a General one (Other,
  // no project). No "Team without a team", no "Other pinned to a project".
  if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
    return { ok: false, error: "A project is required for Team and Partner meetings" };
  }
  if (input.meetingType === "Other" && input.projectId) {
    return { ok: false, error: "General meetings cannot be attached to a project" };
  }

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
      isCoreMeeting: input.isCoreMeeting ?? false,
    },
  });

  let externalEventId: string | null = null;
  let meetingUrl: string | null = null;
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
      // A recurring insert must name the zone its RRULE expands in — anchor it
      // to the organizer's so weekly slots hold their wall-clock time.
      const organizerUser = await prisma.user.findUnique({
        where: { id: input.organizerId },
        select: { timeZone: true },
      });
      try {
        const result = await createGoogleCalendarEvent({
          linkId: organizerLink.id,
          summary: input.title,
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          recurrenceRule: input.recurrenceRule ?? null,
          timeZone: resolveUserTimeZone(organizerUser),
          attendees,
          addMeet: input.addMeet ?? false,
          // Google refuses an insert into a calendar the account can't write,
          // so an unusable id here fails the invite rather than silently
          // filing it somewhere else — the picker only offers writable ones.
          calendarId: input.organizerCalendarId ?? undefined,
        });
        externalEventId = result.eventId;
        meetingUrl = result.meetUrl;
        await prisma.scheduledMeeting.update({
          where: { id: meeting.id },
          data: {
            externalEventId,
            // Google's own invite carries the join link; we store it too so the
            // meeting page can show a Join button and MCP can return it.
            ...(meetingUrl ? { meetingUrl, videoProvider: "GoogleMeet" as const } : {}),
          },
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
    notePageId = await buildMeetingNotePage({
      meetingId: meeting.id,
      authorId: input.organizerId,
      meetingType: input.meetingType,
      meetingTypeLabel: input.meetingTypeLabel ?? null,
      projectId: input.projectId ?? null,
      isCoreMeeting: input.isCoreMeeting ?? false,
      noteLocation: input.noteLocation ?? null,
      startDate,
    });
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
    meeting: { ...meeting, externalEventId, meetingUrl },
    notifiedCount,
    gcalError,
    notePageId,
  };
}

export type AttachMeetingNoteInput = {
  meetingId: string;
  /** Who is adding the note — must be the organizer or Core. Also the note's
   *  creator and the identity project/destination authorization runs against. */
  actorId: string;
  meetingType: MeetingType;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
  noteLocation?: CreateScheduledMeetingInput["noteLocation"];
};

export type AttachMeetingNoteResult =
  | { ok: true; notePageId: string }
  | { ok: false; error: string; status: number };

/**
 * Add a meeting-notes doc to an already-created meeting that doesn't have one.
 * The creation-time note fields (About → project/Team/Partner/General, name,
 * Drive location) aren't captured for a note-less meeting, so this takes them
 * the same way the create form collects them and files the note through the
 * shared buildMeetingNotePage paths. A Core meeting keeps filing to Core's
 * folder regardless of the chosen location (mirrors createScheduledMeeting).
 */
export async function attachMeetingNote(
  input: AttachMeetingNoteInput,
): Promise<AttachMeetingNoteResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      participantUserIds: true,
      isCoreMeeting: true,
      selectedAt: true,
      status: true,
      notePage: { select: { id: true } },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return { ok: false, error: "Meeting not found", status: 404 };
  }
  if (meeting.notePage) {
    return { ok: false, error: "This meeting already has a notes doc", status: 409 };
  }

  // Same authority as cancelling: the organizer owns the meeting, Core has
  // broad access. The client only shows the affordance to those two, but the
  // gate lives here.
  const core = await isCore(input.actorId);
  if (meeting.organizerId !== input.actorId && !core) {
    return { ok: false, error: "Only the organizer or Core can add notes", status: 403 };
  }

  // Same hard constraint as createScheduledMeeting: a project meeting
  // (Team/Partner) needs a project; a General ("Other") one must not have one.
  if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
    return { ok: false, error: "A project is required for Team and Partner meetings", status: 400 };
  }
  if (input.meetingType === "Other" && input.projectId) {
    return { ok: false, error: "General meetings cannot be attached to a project", status: 400 };
  }
  // Filing under a project requires membership (or Core) — mirrors the note
  // destinations the create form offers via /api/move-destinations.
  if (input.projectId) {
    const proj = await prisma.project.findFirst({
      where: {
        id: input.projectId,
        ...(core ? {} : { assignments: { some: { userId: input.actorId } } }),
      },
      select: { id: true },
    });
    if (!proj) return { ok: false, error: "You can't file a note under that project", status: 403 };
  }

  const notePageId = await buildMeetingNotePage({
    meetingId: meeting.id,
    authorId: input.actorId,
    meetingType: input.meetingType,
    meetingTypeLabel: input.meetingTypeLabel ?? null,
    projectId: input.projectId ?? null,
    isCoreMeeting: meeting.isCoreMeeting,
    noteLocation: input.noteLocation ?? null,
    startDate: meeting.selectedAt,
  });

  // Record the derived type/project on the meeting so it reads the same as one
  // configured at creation (the note page is linked via its meetingNoteId FK).
  await prisma.scheduledMeeting.update({
    where: { id: meeting.id },
    data: {
      meetingType: input.meetingType,
      meetingTypeLabel: input.meetingType === "Other" ? (input.meetingTypeLabel ?? null) : null,
      projectId: input.projectId ?? null,
    },
  });

  // Backfill the attendance roster the note's checklist reads. Idempotent — a
  // SelfCheckIn meeting may already have rows, so skip the duplicates.
  const attendeeIds = Array.from(new Set([...meeting.participantUserIds, meeting.organizerId]));
  await prisma.meetingAttendance.createMany({
    data: attendeeIds.map((userId) => ({ scheduledMeetingId: meeting.id, userId })),
    skipDuplicates: true,
  });

  return { ok: true, notePageId };
}

// Grace on either side of a meeting during which self-check-in / wallet-pass
// scan is accepted: from CHECK_IN_GRACE_MIN before the scheduled start to
// CHECK_IN_GRACE_MIN after the scheduled end.
export const CHECK_IN_GRACE_MIN = 15;

// How far either side of `now` to look for an occurrence. An exception can move
// an occurrence off its original slot, and expandOccurrences filters by ORIGINAL
// start, so the scan band has to be wider than the window being tested — a week
// covers "we moved this Tuesday's meeting to Thursday" without expanding a
// pointless number of occurrences.
const OCCURRENCE_SCAN_BAND_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether `now` falls within the check-in window of ANY occurrence of a meeting.
 * Shared by the self-check-in route (api.scheduled-meetings.$id.check-in.ts),
 * the wallet-pass scan route (api.scheduled-meetings.$id.scan-attendee.ts) and
 * the equivalent MCP tools so the window math has one definition.
 *
 * Recurrence is the whole reason this takes a meeting rather than a bare date.
 * `selectedAt` is the FIRST occurrence and never advances, so testing it
 * directly meant a weekly meeting only accepted check-ins during its very first
 * sitting — every occurrence after that reported "window closed" while the
 * meeting was in progress. Exceptions matter for the same reason: a rescheduled
 * occurrence has to be judged at its new time, not its original slot.
 *
 * A meeting with no scheduled time yet has no window (nothing to be early or
 * late for), so this returns false — callers that want to distinguish "no time
 * set" from "window closed" check selectedAt first.
 */
export function isWithinCheckInWindow(
  meeting: {
    selectedAt: Date | null;
    durationMinutes: number;
    recurrenceRule?: string | null;
  },
  exceptions: OccurrenceException[] = [],
  now: number = Date.now(),
): boolean {
  if (!meeting.selectedAt) return false;
  const graceMs = CHECK_IN_GRACE_MIN * 60_000;
  const occurrences = expandOccurrences(
    {
      selectedAt: meeting.selectedAt,
      durationMinutes: meeting.durationMinutes,
      recurrenceRule: meeting.recurrenceRule ?? null,
    },
    exceptions,
    new Date(now - OCCURRENCE_SCAN_BAND_MS),
    new Date(now + OCCURRENCE_SCAN_BAND_MS),
  );
  return occurrences.some(
    (occ) => now >= occ.start.getTime() - graceMs && now <= occ.end.getTime() + graceMs,
  );
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
