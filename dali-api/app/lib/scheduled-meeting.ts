// Shared helper for creating a ScheduledMeeting. Called by the web API
// (app/calendar/routes/api.scheduled-meetings.ts) and the MCP schedule_meeting
// tool. Handles scope resolution, optional Google Calendar push, and
// participant notification fan-out.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers } from "~/lib/groups";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  getGoogleEvent,
  deleteGoogleCalendarEvent,
  type GoogleAttendee,
} from "~/lib/google-calendar";
import { primaryEmail, formatDateShort } from "~/lib/display";
import { resolveUserTimeZone } from "~/lib/timezone";
import { buildIcs } from "~/lib/ics";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotesFolder,
  ensureCoreMeetingNotesFolder,
  ensureLabMeetingNotesFolder,
} from "~/lib/pages";
import { isCore } from "~/lib/roles";
import { expandOccurrences, rruleWithUntil, bareRrule, type OccurrenceException } from "~/lib/meeting-occurrences";
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
  location?: string | null;
  description?: string | null;
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
        location: args.location ?? null,
        description: args.description ?? undefined,
        organizer: { email: args.organizerEmail, name: "DALI OS" },
        attendees: [{ email, name: `${u.firstName} ${u.lastName}`.trim() || email }],
        sequence: args.method === "CANCEL" ? ICS_SEQ_CANCEL : ICS_SEQ_INVITE,
        recurrenceRule: args.recurrenceRule,
      }),
    );
  }
  return byUser;
}

async function googleAttendeesFor(userIds: string[]): Promise<GoogleAttendee[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  const attendees: GoogleAttendee[] = [];
  for (const u of users) {
    const email = primaryEmail(u);
    if (!email) continue;
    attendees.push({ email, displayName: `${u.firstName} ${u.lastName}`.trim() || email });
  }
  return attendees;
}

// The invite's body across all three channels. The ICS (and, for a Google-hosted
// meeting, Google's own invite) carries these fields too, but the in-app feed and
// the Slack DM have no attachment to open — so where and what the meeting is has
// to be in the message itself.
function inviteBody(
  startDate: Date | null,
  location: string | null,
  description: string | null,
): string | null {
  const lines = [
    startDate ? `Starts ${startDate.toISOString()}` : null,
    location ? `Location: ${location}` : null,
    description || null,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
}

// The in-app/email/Slack invite for newly added guests. An ICS rides along only
// when we manage the invite ourselves — a Google-hosted meeting already gets a
// real invite from Google.
async function sendMeetingInvites(args: {
  meetingId: string;
  actorUserId: string;
  title: string;
  startDate: Date | null;
  durationMinutes: number;
  recurrenceRule: string | null;
  ownerCalendarEmail: string;
  googleManaged: boolean;
  sourceGroupId: string | null;
  location: string | null;
  description: string | null;
  recipientIds: string[];
}): Promise<{ inApp: number }> {
  const icsByUser =
    args.startDate && !args.googleManaged
      ? await buildPerRecipientIcs({
          meetingId: args.meetingId,
          method: "REQUEST",
          title: args.title,
          startTime: args.startDate,
          durationMinutes: args.durationMinutes,
          organizerEmail: args.ownerCalendarEmail,
          recurrenceRule: args.recurrenceRule,
          location: args.location,
          description: args.description,
          userIds: args.recipientIds,
        })
      : null;
  return notify({
    eventType: "meeting.invite",
    createdByUserId: args.actorUserId,
    message: {
      title: `Meeting invite: ${args.title}`,
      body: inviteBody(args.startDate, args.location, args.description),
      link: `/calendar?meeting=${args.meetingId}`,
      sourceGroupId: args.sourceGroupId,
      scheduledMeetingId: args.meetingId,
    },
    recipients: args.recipientIds.map((userId) => ({
      userId,
      ics: icsByUser?.get(userId) ?? null,
    })),
  });
}

export type ScheduledMeetingScope =
  | { type: "None" }
  // extraUserIds: guests invited on top of the group (e.g. added after the
  // fact), kept so the meeting stays scoped to the group — and on that group's
  // calendar — instead of collapsing into a plain list.
  | { type: "Group"; groupId: string; extraUserIds?: string[] }
  | { type: "UserList"; participantUserIds: string[] };

async function resolveScope(
  scope: ScheduledMeetingScope,
): Promise<{ participantUserIds: string[]; scopeId: string | null }> {
  if (scope.type === "Group") {
    const members = await resolveGroupMembers(scope.groupId);
    return {
      participantUserIds: Array.from(new Set([...members, ...(scope.extraUserIds ?? [])])),
      scopeId: scope.groupId,
    };
  }
  if (scope.type === "UserList") {
    return { participantUserIds: Array.from(new Set(scope.participantUserIds)), scopeId: null };
  }
  return { participantUserIds: [], scopeId: null };
}

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
  /** Stored on the meeting and mirrored onto the Google event / ICS invite. */
  location?: string | null;
  description?: string | null;
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
    } else if (input.meetingTypeLabel) {
      title = `${input.meetingTypeLabel} (${dateLabel})`;
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

  // General meeting: file the note at the author's chosen Drive location.
  // Include the label in the title so the note stays identifiable wherever it
  // lands.
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
  // No folder chosen — the common case, since the picker defaults to the top of
  // the Lab drive and resolveNoteDestination falls back there for anything it
  // can't honour. The Lab's own "Meeting notes" folder is the default instead
  // of the root, where a note titled just its date went loose among every other
  // Lab doc. An explicitly chosen folder still wins.
  const parentPageId = dest.parentPageId ?? (await ensureLabMeetingNotesFolder(input.authorId));
  const page = await createLabMeetingPage({
    title,
    createdById: input.authorId,
    meetingNoteId: input.meetingId,
    parentPageId,
  });
  return page.id;
}

export async function createScheduledMeeting(
  input: CreateScheduledMeetingInput,
): Promise<CreateScheduledMeetingResult> {
  // Hard constraint (defense in depth alongside the route schema): Team/Partner
  // are project meetings. "Other" may be General (no project) or a custom-named
  // project meeting.
  if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
    return { ok: false, error: "A project is required for Team and Partner meetings" };
  }

  const { participantUserIds, scopeId } = await resolveScope(input.scope);

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

  // Blank is the same as unset here: an untouched field shouldn't persist as "".
  const location = input.location?.trim() || null;
  const description = input.description?.trim() || null;

  const meeting = await prisma.scheduledMeeting.create({
    data: {
      organizerId: input.organizerId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      location,
      description,
      scopeType: input.scope.type,
      scopeId,
      participantUserIds,
      recurrenceRule: input.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ownerCalendarEmail: organizerLink?.externalEmail ?? input.organizerEmail,
      organizerCalendarLinkId: organizerLink?.id ?? null,
      organizerCalendarId: organizerLink ? (input.organizerCalendarId ?? null) : null,
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
    const attendees = await googleAttendeesFor(participantUserIds);
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
          location: location ?? undefined,
          description: description ?? undefined,
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
  // fan out for notes (roster checklist), for SelfCheckIn (QR / self-serve
  // present), and for any meeting with guests — the organizer can mark/scan a
  // roster regardless of whether a note exists. Scope is always the meeting's
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

  if (input.meetingType || attendanceMode === "SelfCheckIn" || participantUserIds.length > 0) {
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
    const result = await sendMeetingInvites({
      meetingId: meeting.id,
      actorUserId: input.organizerId,
      title: input.title,
      startDate,
      durationMinutes: input.durationMinutes,
      recurrenceRule: input.recurrenceRule ?? null,
      ownerCalendarEmail: meeting.ownerCalendarEmail,
      googleManaged: externalEventId !== null,
      sourceGroupId: scopeId,
      location,
      description,
      recipientIds: notifyIds,
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
  // (Team/Partner) needs a project.
  if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
    return { ok: false, error: "A project is required for Team and Partner meetings", status: 400 };
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
 * Admin → Attendance to remove a self-check-in event from the list). Supports
 * scoped cancellation: "this" cancels one occurrence via MeetingException,
 * "following" truncates the series, "all" (default) cancels the whole meeting.
 */
export async function cancelScheduledMeeting(
  meetingId: string,
  actorUserId: string,
  opts?: {
    allowCore?: boolean;
    scope?: "this" | "following" | "all";
    occurrenceStart?: string;
    occurrenceEventId?: string;
  },
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
      organizerCalendarLinkId: true,
      organizerCalendarId: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  if (meeting.organizerId !== actorUserId) {
    if (!opts?.allowCore || !(await isCore(actorUserId))) {
      return { ok: false, error: "Only the organizer can cancel", status: 403 };
    }
  }

  const cancelScope = opts?.scope ?? "all";

  // ── "this" occurrence ────────────────────────────────────────────────────
  if (cancelScope === "this") {
    const occurrenceStart = opts?.occurrenceStart;
    if (!occurrenceStart) {
      return { ok: false, error: "occurrenceStart is required for scope=this", status: 400 };
    }
    await prisma.meetingException.upsert({
      where: {
        scheduledMeetingId_originalStart: {
          scheduledMeetingId: meetingId,
          originalStart: new Date(occurrenceStart),
        },
      },
      create: {
        scheduledMeetingId: meetingId,
        originalStart: new Date(occurrenceStart),
        cancelled: true,
      },
      update: { cancelled: true },
    });
    if (opts?.occurrenceEventId && meeting.organizerCalendarLinkId) {
      try {
        const link = await prisma.userCalendarLink.findUnique({
          where: { id: meeting.organizerCalendarLinkId },
          select: { id: true, enabled: true },
        });
        if (link?.enabled) {
          await deleteGoogleCalendarEvent({
            linkId: link.id,
            calendarId: meeting.organizerCalendarId ?? undefined,
            eventId: opts.occurrenceEventId,
          });
        }
      } catch {
        // best-effort
      }
    }
    const recipients = (meeting.participantUserIds ?? []).filter((id) => id !== actorUserId);
    if (recipients.length > 0) {
      try {
        await notify({
          eventType: "meeting.cancelled",
          createdByUserId: actorUserId,
          message: {
            title: `Meeting occurrence cancelled: ${meeting.title}`,
            link: "/calendar",
          },
          recipients: recipients.map((userId) => ({ userId, ics: null })),
        });
      } catch (err) {
        console.error(`meeting ${meetingId}: occurrence cancel notify failed`, err);
      }
    }
    return { ok: true, alreadyCancelled: false };
  }

  // ── "following" occurrences ───────────────────────────────────────────────
  if (cancelScope === "following") {
    const occurrenceStart = opts?.occurrenceStart;
    if (!occurrenceStart) {
      return { ok: false, error: "occurrenceStart is required for scope=following", status: 400 };
    }
    const untilDate = new Date(new Date(occurrenceStart).getTime() - 1000);
    const truncatedRule = rruleWithUntil(meeting.recurrenceRule ?? "FREQ=WEEKLY", untilDate);
    if (truncatedRule) {
      await prisma.scheduledMeeting.update({
        where: { id: meetingId },
        data: { recurrenceRule: truncatedRule },
      });
      if (meeting.externalEventId && meeting.organizerCalendarLinkId) {
        try {
          const link = await prisma.userCalendarLink.findUnique({
            where: { id: meeting.organizerCalendarLinkId },
            select: { id: true, enabled: true },
          });
          if (link?.enabled) {
            await patchGoogleCalendarEvent({
              linkId: link.id,
              calendarId: meeting.organizerCalendarId ?? undefined,
              eventId: meeting.externalEventId,
              recurrenceRule: truncatedRule,
            });
          }
        } catch {
          // best-effort
        }
      }
    }
    return { ok: true, alreadyCancelled: false };
  }

  // ── "all" (default) ───────────────────────────────────────────────────────
  if (meeting.status === "Cancelled") return { ok: true, alreadyCancelled: true };

  await prisma.scheduledMeeting.update({
    where: { id: meetingId },
    data: { status: "Cancelled" },
  });

  // Delete the Google event best-effort.
  if (meeting.externalEventId && meeting.organizerCalendarLinkId) {
    try {
      const link = await prisma.userCalendarLink.findUnique({
        where: { id: meeting.organizerCalendarLinkId },
        select: { id: true, enabled: true },
      });
      if (link?.enabled) {
        await deleteGoogleCalendarEvent({
          linkId: link.id,
          calendarId: meeting.organizerCalendarId ?? undefined,
          eventId: meeting.externalEventId,
        });
      }
    } catch (err) {
      console.error(`meeting ${meetingId}: Google delete failed`, err);
    }
  }

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

export type UpdateScheduledMeetingInput = {
  title: string;
  durationMinutes: number;
  scope: ScheduledMeetingScope;
  startTime?: string | null;
  recurrenceRule?: string | null;
  // Omitted (undefined) leaves them unchanged; a set value, including "", is
  // written (so clearing a location clears it both here and on Google). A
  // scope="this" edit only writes them to that occurrence's Google event —
  // MeetingException carries no per-occurrence copy of either field.
  location?: string;
  description?: string;
  // Scoped edit fields (optional, default "all"):
  editScope?: "this" | "following" | "all";
  occurrenceStart?: string;   // ISO of this occurrence's ORIGINAL start
  occurrenceEventId?: string; // Google instance event id (for "this" patch)
};

export type UpdateScheduledMeetingResult =
  | { ok: true; meeting: ScheduledMeeting; gcalError: string | null }
  | { ok: false; error: string; status: number };

/**
 * Edit a meeting's title, time, and guest list. The organizer may edit; Core can
 * too (mirrors cancel). Meeting type, project, and any note page are intentionally
 * left untouched — edit is for the schedule and roster, not for turning a meeting
 * into a different kind. The attendance roster is reconciled to the new guest list
 * (rows added for new guests, removed for dropped ones; retained rows keep their
 * present/absenceNote state), and a linked Google event is events.patch'd so the
 * organizer's calendar and its guests stay in sync. Edits apply to the whole
 * series for a recurring meeting.
 */
export async function updateScheduledMeeting(
  meetingId: string,
  actorUserId: string,
  input: UpdateScheduledMeetingInput,
): Promise<UpdateScheduledMeetingResult> {
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
      ownerCalendarEmail: true,
      externalEventId: true,
      organizerCalendarLinkId: true,
      organizerCalendarId: true,
      meetingType: true,
      attendanceMode: true,
      recurrenceRule: true,
      scopeType: true,
      scopeId: true,
      isCoreMeeting: true,
      meetingTypeLabel: true,
      projectId: true,
      location: true,
      description: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  if (meeting.status === "Cancelled") {
    return { ok: false, error: "This meeting has been cancelled", status: 400 };
  }

  if (meeting.organizerId !== actorUserId && !(await isCore(actorUserId))) {
    return { ok: false, error: "Only the organizer or Core can edit this meeting", status: 403 };
  }

  const editScope = input.editScope ?? "all";

  // ── "this" occurrence ────────────────────────────────────────────────────
  if (editScope === "this") {
    const occurrenceStart = input.occurrenceStart;
    if (!occurrenceStart) {
      return { ok: false, error: "occurrenceStart is required for scope=this", status: 400 };
    }
    const startDate = input.startTime ? new Date(input.startTime) : null;
    await prisma.meetingException.upsert({
      where: {
        scheduledMeetingId_originalStart: {
          scheduledMeetingId: meetingId,
          originalStart: new Date(occurrenceStart),
        },
      },
      create: {
        scheduledMeetingId: meetingId,
        originalStart: new Date(occurrenceStart),
        overrideStart: startDate,
        overrideDurationMin: input.durationMinutes,
        overrideTitle: input.title,
        cancelled: false,
      },
      update: {
        overrideStart: startDate,
        overrideDurationMin: input.durationMinutes,
        overrideTitle: input.title,
        cancelled: false,
      },
    });

    let gcalError: string | null = null;
    if (input.occurrenceEventId && meeting.organizerCalendarLinkId) {
      try {
        const link = await prisma.userCalendarLink.findUnique({
          where: { id: meeting.organizerCalendarLinkId },
          select: { id: true, enabled: true },
        });
        if (link?.enabled && startDate) {
          const endDate = new Date(startDate.getTime() + input.durationMinutes * 60_000);
          await patchGoogleCalendarEvent({
            linkId: link.id,
            calendarId: meeting.organizerCalendarId ?? undefined,
            eventId: input.occurrenceEventId,
            summary: input.title,
            startIso: startDate.toISOString(),
            endIso: endDate.toISOString(),
            ...(input.location !== undefined ? { location: input.location } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            sendUpdates: "all",
          });
        }
      } catch (err) {
        gcalError = err instanceof Error ? err.message : "Google Calendar update failed";
      }
    }

    const updated = await prisma.scheduledMeeting.findUnique({ where: { id: meetingId } });
    return { ok: true, meeting: updated!, gcalError };
  }

  // ── "following" occurrences ───────────────────────────────────────────────
  if (editScope === "following") {
    const occurrenceStart = input.occurrenceStart;
    if (!occurrenceStart) {
      return { ok: false, error: "occurrenceStart is required for scope=following", status: 400 };
    }
    const untilDate = new Date(new Date(occurrenceStart).getTime() - 1000);
    const truncatedRule = rruleWithUntil(meeting.recurrenceRule ?? "FREQ=WEEKLY", untilDate);
    if (truncatedRule) {
      await prisma.scheduledMeeting.update({
        where: { id: meetingId },
        data: { recurrenceRule: truncatedRule },
      });
      if (meeting.externalEventId && meeting.organizerCalendarLinkId) {
        try {
          const link = await prisma.userCalendarLink.findUnique({
            where: { id: meeting.organizerCalendarLinkId },
            select: { id: true, enabled: true },
          });
          if (link?.enabled) {
            await patchGoogleCalendarEvent({
              linkId: link.id,
              calendarId: meeting.organizerCalendarId ?? undefined,
              eventId: meeting.externalEventId,
              recurrenceRule: truncatedRule,
            });
          }
        } catch {
          // Best-effort; the DALI truncation already landed.
        }
      }
    }

    const newRule = bareRrule(meeting.recurrenceRule ?? "FREQ=WEEKLY");

    const ownerLink = meeting.organizerCalendarLinkId
      ? await prisma.userCalendarLink.findUnique({
          where: { id: meeting.organizerCalendarLinkId },
          select: { id: true, externalEmail: true },
        })
      : null;

    const newMeetingResult = await createScheduledMeeting({
      organizerId: meeting.organizerId,
      organizerEmail: ownerLink?.externalEmail ?? meeting.ownerCalendarEmail,
      title: input.title,
      durationMinutes: input.durationMinutes,
      // The new series carries the edit's guest list (the composer's picker),
      // not the master's — a "this and following" edit applies guest changes too.
      scope: input.scope,
      startTime: occurrenceStart,
      recurrenceRule: newRule,
      organizerCalendarLinkId: meeting.organizerCalendarLinkId,
      organizerCalendarId: meeting.organizerCalendarId,
      meetingType: meeting.meetingType,
      meetingTypeLabel: meeting.meetingTypeLabel,
      projectId: meeting.projectId,
      isCoreMeeting: meeting.isCoreMeeting,
      location: input.location ?? meeting.location,
      description: input.description ?? meeting.description,
    });

    if (!newMeetingResult.ok) {
      return { ok: false, error: newMeetingResult.error, status: 500 };
    }
    return { ok: true, meeting: newMeetingResult.meeting, gcalError: newMeetingResult.gcalError };
  }

  // ── "all" (default) — existing behavior ──────────────────────────────────
  const { participantUserIds, scopeId } = await resolveScope(input.scope);

  const startDate = input.startTime ? new Date(input.startTime) : null;

  const updated = await prisma.scheduledMeeting.update({
    where: { id: meetingId },
    data: {
      title: input.title,
      durationMinutes: input.durationMinutes,
      scopeType: input.scope.type,
      scopeId,
      participantUserIds,
      recurrenceRule: input.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ...(input.location !== undefined ? { location: input.location.trim() || null } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
    },
  });

  // Reconcile the roster to the new guest list. A meeting stays attendance-tracked
  // while it has a note, self check-in, or any guests; editing it down to none
  // drops its roster (and with it the Attendance-tab row), same as create's gate.
  const tracksAttendance =
    meeting.meetingType !== null ||
    meeting.attendanceMode === "SelfCheckIn" ||
    participantUserIds.length > 0;
  const desiredIds = tracksAttendance
    ? new Set([...participantUserIds, meeting.organizerId])
    : new Set<string>();
  const existingRows = await prisma.meetingAttendance.findMany({
    where: { scheduledMeetingId: meetingId },
    select: { userId: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.userId));
  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
  if (toAdd.length > 0) {
    await prisma.meetingAttendance.createMany({
      data: toAdd.map((userId) => ({ scheduledMeetingId: meetingId, userId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.meetingAttendance.deleteMany({
      where: { scheduledMeetingId: meetingId, userId: { in: toRemove } },
    });
  }

  // Re-sync the Google event (title, time, guests, recurrence) when one exists.
  // Best-effort — the DALI-side edit already landed; a Google hiccup is surfaced
  // to the caller, not fatal. sendUpdates:"all" has Google email guests (added,
  // removed, and retained) about the change.
  let gcalError: string | null = null;
  if (meeting.externalEventId && meeting.organizerCalendarLinkId) {
    try {
      const link = await prisma.userCalendarLink.findUnique({
        where: { id: meeting.organizerCalendarLinkId },
        select: { id: true, enabled: true },
      });
      if (link?.enabled) {
        const attendees = await googleAttendeesFor(participantUserIds);
        const organizerUser = await prisma.user.findUnique({
          where: { id: meeting.organizerId },
          select: { timeZone: true },
        });
        const endDate = startDate
          ? new Date(startDate.getTime() + input.durationMinutes * 60_000)
          : null;
        await patchGoogleCalendarEvent({
          linkId: link.id,
          calendarId: meeting.organizerCalendarId ?? undefined,
          eventId: meeting.externalEventId,
          summary: input.title,
          ...(startDate && endDate
            ? { startIso: startDate.toISOString(), endIso: endDate.toISOString() }
            : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          recurrenceRule: input.recurrenceRule ?? null,
          timeZone: resolveUserTimeZone(organizerUser),
          attendees,
          sendUpdates: "all",
        });
      }
    } catch (err) {
      gcalError = err instanceof Error ? err.message : "Google Calendar update failed";
    }
  }

  // Tell the people whose invitation changed: new guests get an invite, dropped
  // guests get a cancellation. Retained guests are handled by Google's own email
  // above (or, for a non-Google meeting, left as-is — an in-app time change is
  // visible on their calendar). An ICS is attached only when we manage the invite
  // ourselves, i.e. there's no Google event mirroring it.
  const selfManaged = !meeting.externalEventId && startDate !== null;
  const addedRecipients = toAdd.filter((id) => id !== meeting.organizerId);
  const removedRecipients = toRemove.filter((id) => id !== meeting.organizerId);
  try {
    if (addedRecipients.length > 0) {
      await sendMeetingInvites({
        meetingId: updated.id,
        actorUserId,
        title: input.title,
        startDate,
        durationMinutes: input.durationMinutes,
        recurrenceRule: input.recurrenceRule ?? null,
        ownerCalendarEmail: meeting.ownerCalendarEmail,
        googleManaged: meeting.externalEventId !== null,
        sourceGroupId: scopeId,
        location: updated.location,
        description: updated.description,
        recipientIds: addedRecipients,
      });
    }
    if (removedRecipients.length > 0) {
      const ics = selfManaged
        ? await buildPerRecipientIcs({
            meetingId: updated.id,
            method: "CANCEL",
            title: input.title,
            startTime: startDate!,
            durationMinutes: input.durationMinutes,
            organizerEmail: meeting.ownerCalendarEmail,
            recurrenceRule: input.recurrenceRule ?? null,
            userIds: removedRecipients,
          })
        : null;
      await notify({
        eventType: "meeting.cancelled",
        createdByUserId: actorUserId,
        message: {
          title: `Removed from meeting: ${input.title}`,
          link: "/calendar",
        },
        recipients: removedRecipients.map((userId) => ({
          userId,
          ics: ics?.get(userId) ?? null,
        })),
      });
    }
  } catch (err) {
    console.error(`meeting ${meetingId}: edit notify failed`, err);
  }

  return { ok: true, meeting: updated, gcalError };
}

/** Whether a meeting still has an occurrence ahead of `now`. A series is treated
 *  as ongoing; an unscheduled (Searching) meeting hasn't happened yet. */
export function meetingIsUpcoming(
  meeting: { selectedAt: Date | null; durationMinutes: number; recurrenceRule: string | null },
  now: Date,
): boolean {
  if (meeting.recurrenceRule || !meeting.selectedAt) return true;
  return meeting.selectedAt.getTime() + meeting.durationMinutes * 60_000 > now.getTime();
}

export type TrackExternalEventInput = {
  actorId: string;
  /** The Google event the viewer is looking at, and its master when it's one
   *  instance of a series. */
  eventId: string;
  recurringEventId?: string | null;
  linkId: string;
  calendarId: string;
};

export type TrackExternalEventResult =
  | { ok: true; meeting: ScheduledMeeting }
  | { ok: false; error: string; status: number };

/**
 * Give an external Google event the DALI meeting it never had.
 *
 * The lab's general calendar is authored in Google Calendar, not in DALI, so
 * its events reach the grid as plain external events: there is no
 * ScheduledMeeting row behind them, and therefore no meeting note and no
 * attendance roster — the gap that made those events look broken next to every
 * other meeting on the same grid. This creates the missing row, bound to the
 * Google event through `externalEventId`, after which the ordinary note and
 * attendance affordances work exactly as they do for a DALI-created meeting.
 *
 * Deliberately NOT built on createScheduledMeeting, which exists to bring an
 * event into being: it pushes to Google and fans out invites. Both are wrong
 * here — the event already exists and Google has already invited everyone, so
 * doing either would duplicate the event on people's calendars and mail them
 * an invite to a meeting they are already going to.
 *
 * A series binds to its master id, matching how meetingsForExternalEvents
 * resolves an expanded instance, so tracking one occurrence covers the series —
 * one note and one roster for a weekly lab meeting, not one per week.
 */
export async function trackExternalEventAsMeeting(
  input: TrackExternalEventInput,
): Promise<TrackExternalEventResult> {
  if (!(await isCore(input.actorId))) {
    return { ok: false, error: "Only Core can track an event in DALI", status: 403 };
  }

  const link = await prisma.userCalendarLink.findUnique({
    where: { id: input.linkId },
    select: { id: true, userId: true, externalEmail: true },
  });
  if (!link || link.userId !== input.actorId) {
    return { ok: false, error: "Not found", status: 404 };
  }

  // The form names the event; Google is asked what it actually is. Title,
  // times and attendees all come from the read, never from the client.
  let event: Awaited<ReturnType<typeof getGoogleEvent>>;
  try {
    event = await getGoogleEvent({
      linkId: link.id,
      calendarId: input.calendarId,
      eventId: input.eventId,
    });
  } catch {
    return { ok: false, error: "Couldn't read that event from Google", status: 502 };
  }

  const externalEventId = input.recurringEventId || event.id;
  const existing = await prisma.scheduledMeeting.findFirst({
    where: { externalEventId, status: { not: "Cancelled" } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "This event is already tracked in DALI", status: 409 };
  }

  const startDate = event.startIso
    ? new Date(event.startIso)
    : event.startDate
      ? new Date(`${event.startDate}T00:00:00Z`)
      : null;
  const endDate = event.endIso
    ? new Date(event.endIso)
    : event.endDate
      ? new Date(`${event.endDate}T00:00:00Z`)
      : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return { ok: false, error: "That event has no start time", status: 400 };
  }
  const durationMinutes =
    endDate && endDate > startDate
      ? Math.round((endDate.getTime() - startDate.getTime()) / 60_000)
      : 60;

  // The roster starts as whoever Google already has on the event, resolved to
  // DALI members. An event on the general calendar often has no guest list at
  // all, and that's fine — the roster is editable on the meeting page, and the
  // actor is always on it.
  const attendeeEmails = event.attendeeEmails.map((e) => e.toLowerCase());
  const attendees = attendeeEmails.length
    ? await prisma.user.findMany({
        where: {
          daliMember: { isNot: null },
          OR: [
            { daliEmail: { in: attendeeEmails, mode: "insensitive" } },
            { dartmouthEmail: { in: attendeeEmails, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      })
    : [];
  const participantUserIds = attendees
    .map((u) => u.id)
    .filter((id) => id !== input.actorId);

  const meeting = await prisma.scheduledMeeting.create({
    data: {
      // The actor, not the Google organizer: organizerId is who may manage the
      // meeting in DALI, and the Google organizer may not even be a member.
      organizerId: input.actorId,
      title: event.summary?.trim() || "Untitled event",
      durationMinutes,
      location: event.location,
      description: event.description,
      // "None" — not scoped to a group or a hand-picked list. It is the marker
      // the meeting page reads to let any lab member see a lab-wide meeting.
      scopeType: "None",
      participantUserIds,
      selectedAt: startDate,
      status: "Confirmed",
      externalEventId,
      recurrenceRule: event.recurrence[0]?.replace(/^RRULE:/, "") ?? null,
      ownerCalendarEmail: link.externalEmail,
      organizerCalendarLinkId: link.id,
    },
  });

  // The roster the attendance checklist reads. The actor is always present on
  // it so the meeting page is never an empty shell.
  await prisma.meetingAttendance.createMany({
    data: Array.from(new Set([...participantUserIds, input.actorId])).map((userId) => ({
      scheduledMeetingId: meeting.id,
      userId,
    })),
    skipDuplicates: true,
  });

  return { ok: true, meeting };
}
