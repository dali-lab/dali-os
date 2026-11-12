// Shared helper for creating a ScheduledMeeting. Called by the web API
// (app/calendar/routes/api.scheduled-meetings.ts) and the MCP schedule_meeting
// tool. Handles scope resolution, optional Google Calendar push, and
// participant notification fan-out.

import { prisma } from "~/lib/db.server";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers } from "~/lib/groups";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  getGoogleEvent,
  deleteGoogleCalendarEvent,
} from "~/calendar/lib/google-calendar.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { isCore } from "~/lib/roles";
import { isGeneralCalendarEvent } from "~/calendar/lib/general-calendar";
import { loadEditableNotebook, NotebookError } from "~/calendar/lib/notebooks.server";
import { isExistingChoice, type NotebookChoice, type NotebookSpaceChoice } from "~/calendar/lib/notebook-choice";
import { normalizeGuestEmails } from "~/calendar/lib/guest-emails";
import { syncMeetingShares } from "~/calendar/lib/meeting-shares.server";
import {
  googleSeriesBase,
  googleSeriesBaseUID,
  rruleWithUntil,
  followingRule,
  tracksAttendance,
  ownsGoogleEvent,
} from "~/calendar/lib/meeting-occurrences";
import type { ScheduledMeeting, MeetingType, AttendanceMode } from "~/generated/prisma/client";
import { seedMeetingRoster, ensureOccurrenceRoster } from "~/calendar/lib/meeting-roster.server";
import { buildPerRecipientIcs, googleAttendeesFor, sendMeetingInvites } from "~/calendar/lib/meeting-invites.server";
import {
  buildMeetingArtifactPage,
  type ResolvedNotebook,
  resolveFolderFiling,
  resolveNotebookChoice,
  typeForNotebookFiling,
  seedNoteFromTemplate,
} from "~/calendar/lib/meeting-artifacts.server";

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
  /** Save the meeting without pushing a Google event (a continuation of a Google event DALI doesn't own). */
  skipGoogle?: boolean;
  /** Stored on the meeting and mirrored onto the Google event / ICS invite. */
  location?: string | null;
  description?: string | null;
  /** The DALI rooms this meeting occupies. The caller checks they're free (assertMeetingRoomsFree). */
  roomIds?: string[];
  // Meeting-asset fields. When meetingType is set, the meeting records its type
  // and a MeetingAttendance row is fanned out per participant (incl. the
  // organizer). meetingTypeLabel supplies the display label — required when
  // meetingType is "Other", ignored otherwise (Team/Partner have fixed labels).
  meetingType?: MeetingType | null;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
  // Which assets to create for the meeting (both file under the resolved
  // location/folder). Default: a note when createNote is omitted but meetingType
  // is set (back-compat for callers that only set meetingType), no whiteboard.
  createNote?: boolean;
  createWhiteboard?: boolean;
  /** Which notebook the first note files into (and the series defaults to).
   *  When set without a meetingType, the type is derived from it. */
  notebook?: NotebookChoice | null;
  request?: Request;
  // Roster (default): organizer/Core check attendees off by hand (needs a
  // meeting note for the checklist UI). SelfCheckIn: attendees mark themselves
  // present via the check-in route — works with or without a meeting note (QR
  // lives on the note when present, otherwise on /calendar/check-in/:id).
  attendanceMode?: AttendanceMode;
  // Core marker — see ScheduledMeeting.isCoreMeeting. Callers are responsible
  // for checking the setter is Core; this layer just persists the flag. It also
  // decides where a project-less note is filed: Core's own meeting-notes folder
  // rather than the Lab's.
  isCoreMeeting?: boolean;
  // Mint a Google Meet link for the meeting. Only takes effect when the meeting
  // is actually pushed to the organizer's linked Google calendar (a start time,
  // participants, and an enabled calendar link) — the link is born on that
  // event and Google's invite carries it. No-op otherwise.
  addMeet?: boolean;
  // Invitees with no DALI profile — see ScheduledMeeting.guestEmails. They
  // reach the meeting only through the Google event, so they need a linked
  // organizer calendar and a start time to be invited.
  guestEmails?: string[];
};

export type CreateScheduledMeetingResult =
  | {
      ok: true;
      meeting: ScheduledMeeting & { externalEventId: string | null };
      notifiedCount: number;
      gcalError: string | null;
      notePageId: string | null;
      /** The notebook the note is a tab of, and whether this call created it. */
      notebookId: string | null;
      createdNotebook: boolean;
      whiteboardPageId: string | null;
    }
  | { ok: false; error: string };

async function createScheduledMeetingImpl(
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

  const wantsAssets = !!input.notebook || input.createNote === true || input.createWhiteboard === true;
  const newChoice = input.notebook && !isExistingChoice(input.notebook) ? input.notebook : null;
  let folderSpace: NotebookSpaceChoice | undefined;
  if (newChoice?.folderPageId) {
    try {
      folderSpace = (await resolveFolderFiling(newChoice.folderPageId, input.organizerId, input.request)).space;
    } catch (err) {
      if (err instanceof NotebookError) return { ok: false, error: err.message };
      throw err;
    }
  }
  const chosenSpace = folderSpace ?? newChoice?.space;
  const givenProjectId = chosenSpace?.kind === "project" ? chosenSpace.projectId : (input.projectId ?? null);
  const isCoreMeeting = (input.isCoreMeeting ?? false) || folderSpace?.kind === "core";
  if (chosenSpace?.kind === "core" && !isCoreMeeting) {
    return { ok: false, error: "Only Core can start a notebook in Core" };
  }
  let notebookPlan: ResolvedNotebook | null = null;
  if (input.notebook) {
    try {
      notebookPlan = await resolveNotebookChoice(
        input.notebook,
        input.organizerId,
        (title) => ({
          authorId: input.organizerId,
          ...typeForNotebookFiling(input, givenProjectId, title),
          projectId: givenProjectId,
          isCoreMeeting: isCoreMeeting,
        }),
        input.request,
      );
    } catch (err) {
      if (err instanceof NotebookError) return { ok: false, error: err.message };
      throw err;
    }
  }
  const recorded =
    input.meetingType || wantsAssets
      ? typeForNotebookFiling(input, givenProjectId, notebookPlan?.title ?? input.title)
      : null;

  const attendanceMode = input.attendanceMode ?? "Roster";
  // A self-check-in event this large (an all-lab Group meeting, a big
  // workshop) is exactly the "too many people to usefully record" case the
  // record prompt isn't built for — default its three surfaces off rather
  // than make the organizer turn it off after the fact.
  const recordPrompt = !(attendanceMode === "SelfCheckIn" && participantUserIds.length > 30);

  // Blank is the same as unset here: an untouched field shouldn't persist as "".
  const location = input.location?.trim() || null;
  const description = input.description?.trim() || null;
  const guestEmails = normalizeGuestEmails(input.guestEmails ?? []);

  const meeting = await prisma.scheduledMeeting.create({
    data: {
      organizerId: input.organizerId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      location,
      description,
      ...(input.roomIds?.length ? { rooms: { connect: input.roomIds.map((id) => ({ id })) } } : {}),
      scopeType: input.scope.type,
      scopeId,
      participantUserIds,
      guestEmails,
      recurrenceRule: input.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ownerCalendarEmail: organizerLink?.externalEmail ?? input.organizerEmail,
      organizerCalendarLinkId: organizerLink?.id ?? null,
      organizerCalendarId: organizerLink ? (input.organizerCalendarId ?? null) : null,
      meetingType: recorded?.meetingType ?? null,
      meetingTypeLabel: recorded?.meetingType === "Other" ? recorded.meetingTypeLabel : null,
      projectId: recorded ? givenProjectId : null,
      notebookId: notebookPlan?.id ?? null,
      attendanceMode,
      isCoreMeeting: isCoreMeeting,
      recordPrompt,
    },
  });
  if (notebookPlan) await syncMeetingShares(meeting.id, input.request);

  let externalEventId: string | null = null;
  let meetingUrl: string | null = null;
  let gcalError: string | null = null;
  if (
    !input.skipGoogle &&
    organizerLink &&
    organizerLink.enabled &&
    startDate &&
    (participantUserIds.length > 0 || guestEmails.length > 0)
  ) {
    const attendees = await googleAttendeesFor(participantUserIds, guestEmails);
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
            googleEventOrigin: "Created",
            // Stable RFC 5545 join key — see ScheduledMeeting.iCalUID. Captured
            // at push time so new meetings never depend on the mutable event id.
            iCalUID: result.iCalUID,
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
  let whiteboardPageId: string | null = null;
  let notebookId: string | null = null;
  let createdNotebook = false;
  if (recorded) {
    // Default to a note (and no board) when the caller only set meetingType —
    // matches the pre-whiteboard behaviour for MCP and other callers.
    const wantNote = input.createNote ?? true;
    const wantWhiteboard = input.createWhiteboard ?? false;
    const common = {
      meetingId: meeting.id,
      authorId: input.organizerId,
      meetingType: recorded.meetingType,
      meetingTypeLabel: recorded.meetingTypeLabel,
      projectId: givenProjectId,
      isCoreMeeting: isCoreMeeting,
      startDate,
    };
    if (wantNote) {
      const note = await buildMeetingArtifactPage({
        ...common,
        artifact: "note",
        occurrenceStart: startDate ?? meeting.createdAt,
        notebookId: notebookPlan?.id ?? null,
      });
      notePageId = note.id;
      notebookId = note.notebookId;
      createdNotebook = notebookPlan?.created ?? note.createdNotebook;
      if (notebookPlan) {
        await seedNoteFromTemplate(note.id, givenProjectId, recorded.meetingType, notebookPlan.templatePageId);
      }
    }
    if (wantWhiteboard) {
      whiteboardPageId = (
        await buildMeetingArtifactPage({ ...common, artifact: "whiteboard", fileAt: notebookPlan?.primary })
      ).id;
    }
  }

  if (recorded || attendanceMode === "SelfCheckIn" || participantUserIds.length > 0) {
    await seedMeetingRoster({
      id: meeting.id,
      organizerId: input.organizerId,
      participantUserIds,
      selectedAt: startDate,
      createdAt: meeting.createdAt,
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
    notebookId,
    createdNotebook,
    whiteboardPageId,
  };
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
async function cancelScheduledMeetingImpl(
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
      googleEventOrigin: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  const ownsGoogle = ownsGoogleEvent(meeting);
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
    if (ownsGoogle && opts?.occurrenceEventId && meeting.organizerCalendarLinkId) {
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
            copyKey: "meeting.cancelled.occurrence",
      vars: { itemTitle: meeting.title },
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
      if (ownsGoogle && meeting.externalEventId && meeting.organizerCalendarLinkId) {
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

  // Google owns the invite and its cancellation notices for a tracked event.
  if (!ownsGoogle) return { ok: true, alreadyCancelled: false };

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
          copyKey: "meeting.cancelled.series",
      vars: { itemTitle: meeting.title },
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
  // Omitted leaves the rooms alone; a list (possibly empty) replaces them.
  // Rooms belong to the whole series, so a scope="this" edit ignores them.
  // The caller checks they're free.
  roomIds?: string[];
  // Omitted leaves the stored guest emails alone; a set list replaces them.
  guestEmails?: string[];
  // Scoped edit fields (optional, default "all"):
  editScope?: "this" | "following" | "all";
  occurrenceStart?: string;   // ISO of this occurrence's ORIGINAL start
  occurrenceEventId?: string; // Google instance event id (for "this" patch)
};

// Slide every occurrence key a meeting has — attendance rows, meeting hours,
// note pages — by the same amount, for a whole-meeting reschedule. The key is an
// occurrence's original start, so moving the meeting has to move the keys too.
//
// Two hops, because the unique keys are checked row by row: moving a weekly
// meeting a week later would land week 1 on week 2 before week 2 had moved. The
// first hop parks every key far past anything real; the second brings them in.
const PARK_MS = 100 * 365 * 24 * 60 * 60_000;
async function shiftOccurrenceKeys(meetingId: string, shiftMs: number): Promise<void> {
  const hops = [`${PARK_MS} milliseconds`, `${shiftMs - PARK_MS} milliseconds`];
  await prisma.$transaction(
    hops.flatMap((interval) => [
      prisma.$executeRaw`UPDATE "MeetingAttendance" SET "occurrenceStart" = "occurrenceStart" + ${interval}::interval WHERE "scheduledMeetingId" = ${meetingId}`,
      prisma.$executeRaw`UPDATE "TimeEntry" SET "occurrenceStart" = "occurrenceStart" + ${interval}::interval WHERE "scheduledMeetingId" = ${meetingId}`,
      prisma.$executeRaw`UPDATE "Page" SET "meetingOccurrenceStart" = "meetingOccurrenceStart" + ${interval}::interval WHERE "meetingNoteId" = ${meetingId}`,
    ]),
  );
}

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
async function updateScheduledMeetingImpl(
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
      guestEmails: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      ownerCalendarEmail: true,
      externalEventId: true,
      organizerCalendarLinkId: true,
      organizerCalendarId: true,
      googleEventOrigin: true,
      meetingType: true,
      notebookId: true,
      attendanceMode: true,
      recurrenceRule: true,
      scopeType: true,
      scopeId: true,
      isCoreMeeting: true,
      meetingTypeLabel: true,
      projectId: true,
      location: true,
      description: true,
      rooms: { select: { id: true } },
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
  const ownsGoogle = ownsGoogleEvent(meeting);

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
    if (ownsGoogle && input.occurrenceEventId && meeting.organizerCalendarLinkId) {
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
    let notebook: { existingId: string } | undefined;
    if (meeting.notebookId) {
      try {
        await loadEditableNotebook(meeting.notebookId, meeting.organizerId);
        notebook = { existingId: meeting.notebookId };
      } catch (err) {
        if (!(err instanceof NotebookError)) throw err;
      }
    }

    const untilDate = new Date(new Date(occurrenceStart).getTime() - 1000);
    const truncatedRule = rruleWithUntil(meeting.recurrenceRule ?? "FREQ=WEEKLY", untilDate);
    if (truncatedRule) {
      await prisma.scheduledMeeting.update({
        where: { id: meetingId },
        data: { recurrenceRule: truncatedRule },
      });
      if (ownsGoogle && meeting.externalEventId && meeting.organizerCalendarLinkId) {
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

    const newRule = followingRule(meeting.recurrenceRule ?? "FREQ=WEEKLY", meeting.selectedAt ?? meeting.createdAt, new Date(occurrenceStart));

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
      skipGoogle: !ownsGoogle,
      meetingType: meeting.meetingType,
      meetingTypeLabel: meeting.meetingTypeLabel,
      projectId: meeting.projectId,
      isCoreMeeting: meeting.isCoreMeeting,
      location: input.location ?? meeting.location,
      description: input.description ?? meeting.description,
      roomIds: input.roomIds ?? meeting.rooms.map((r) => r.id),
      guestEmails: input.guestEmails ?? meeting.guestEmails,
      notebook,
      createNote: false,
    });

    if (!newMeetingResult.ok) {
      return { ok: false, error: newMeetingResult.error, status: 500 };
    }

    const cutNote = await prisma.page.updateMany({
      where: { meetingNoteId: meetingId, meetingOccurrenceStart: new Date(occurrenceStart), archivedAt: null },
      data: {
        meetingNoteId: newMeetingResult.meeting.id,
        meetingOccurrenceStart: input.startTime ? new Date(input.startTime) : new Date(occurrenceStart),
      },
    });
    if (cutNote.count > 0) {
      await Promise.all([syncMeetingShares(meetingId), syncMeetingShares(newMeetingResult.meeting.id)]);
    }
    return { ok: true, meeting: newMeetingResult.meeting, gcalError: newMeetingResult.gcalError };
  }

  // ── "all" (default) — existing behavior ──────────────────────────────────
  const { participantUserIds, scopeId } = await resolveScope(input.scope);
  const guestEmails =
    input.guestEmails !== undefined ? normalizeGuestEmails(input.guestEmails) : meeting.guestEmails;

  const startDate = input.startTime ? new Date(input.startTime) : null;

  const updated = await prisma.scheduledMeeting.update({
    where: { id: meetingId },
    data: {
      title: input.title,
      durationMinutes: input.durationMinutes,
      scopeType: input.scope.type,
      scopeId,
      participantUserIds,
      guestEmails,
      recurrenceRule: input.recurrenceRule ?? null,
      selectedAt: startDate,
      status: startDate ? "Confirmed" : "Searching",
      ...(input.location !== undefined ? { location: input.location.trim() || null } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
      ...(input.roomIds !== undefined ? { rooms: { set: input.roomIds.map((id) => ({ id })) } } : {}),
    },
  });

  // Reconcile the roster to the new guest list; a meeting that no longer
  // tracksAttendance drops its roster (and with it the Attendance-tab row).
  const desiredIds = tracksAttendance({ ...meeting, participantUserIds })
    ? new Set([...participantUserIds, meeting.organizerId])
    : new Set<string>();
  const existingRows = await prisma.meetingAttendance.findMany({
    where: { scheduledMeetingId: meetingId },
    select: { userId: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.userId));
  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
  // Moving the meeting moves every occurrence's key with it, so the notes,
  // roster and hours already recorded stay on the occurrences they belong to.
  // The calendar edits a series from whichever instance was clicked, so the
  // move is measured from that instance's original start, not the first one's.
  const oldBase = meeting.selectedAt ?? meeting.createdAt;
  const newBase = startDate ?? meeting.createdAt;
  const movedFrom =
    meeting.selectedAt && input.occurrenceStart ? new Date(input.occurrenceStart) : oldBase;
  const shiftMs = newBase.getTime() - movedFrom.getTime();
  if (shiftMs !== 0) await shiftOccurrenceKeys(meetingId, shiftMs);
  if (toAdd.length > 0) {
    // New guests join the first occurrence's roster; later occurrences pick
    // them up as they're opened (ensureOccurrenceRoster).
    await prisma.meetingAttendance.createMany({
      data: toAdd.map((userId) => ({ scheduledMeetingId: meetingId, occurrenceStart: newBase, userId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.meetingAttendance.deleteMany({
      where: { scheduledMeetingId: meetingId, userId: { in: toRemove } },
    });
  }
  await syncMeetingShares(meetingId);

  // Re-sync the Google event (title, time, guests, recurrence) when one exists.
  // Best-effort — the DALI-side edit already landed; a Google hiccup is surfaced
  // to the caller, not fatal. sendUpdates:"all" has Google email guests (added,
  // removed, and retained) about the change.
  let gcalError: string | null = null;
  if (ownsGoogle && meeting.externalEventId && meeting.organizerCalendarLinkId) {
    try {
      const link = await prisma.userCalendarLink.findUnique({
        where: { id: meeting.organizerCalendarLinkId },
        select: { id: true, enabled: true },
      });
      if (link?.enabled) {
        const attendees = await googleAttendeesFor(participantUserIds, guestEmails);
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
          copyKey: "meeting.removed",
      vars: { itemTitle: input.title },
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
  | { ok: true; meeting: Pick<ScheduledMeeting, "id"> }
  | { ok: false; error: string; status: number };

/**
 * Give an external Google event the DALI meeting it never had.
 *
 * The lab's general calendar is authored in Google Calendar, not in DALI, and a
 * member's own event can be created as a plain event too, so
 * these reach the grid as plain external events: there is no
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
 *
 * Re-tracking an already-tracked event joins the actor to its roster instead of
 * refusing, because an incomplete roster — e.g. an organizer Google didn't list
 * as a guest — must not lock that person out of their own meeting.
 */
export async function trackExternalEventAsMeeting(
  input: TrackExternalEventInput,
): Promise<TrackExternalEventResult> {
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

  // Core can track any event it can read (the general calendar's have no guest
  // list). Anyone else has to be on the event: its organizer or a guest, as
  // Google reports it for their own account.
  const labWide = isGeneralCalendarEvent(input.calendarId);
  if (!event.viewerInvited && !(await isCore(input.actorId))) {
    return { ok: false, error: "Only someone on this event can track it in DALI", status: 403 };
  }

  const externalEventId = input.recurringEventId || event.id;

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

  const baseEventId = googleSeriesBase(externalEventId);
  const baseUID = event.iCalUID ? googleSeriesBaseUID(event.iCalUID) : null;
  const candidates = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      OR: [
        { externalEventId },
        ...(baseEventId !== externalEventId ? [{ externalEventId: baseEventId }] : []),
        ...(event.iCalUID ? [{ iCalUID: event.iCalUID }] : []),
        ...(baseUID && baseUID !== event.iCalUID ? [{ iCalUID: baseUID }] : []),
      ],
    },
    select: { id: true, organizerId: true, participantUserIds: true, externalEventId: true, iCalUID: true },
  });
  const existing =
    candidates.find(
      (m) => m.externalEventId === externalEventId || (event.iCalUID != null && m.iCalUID === event.iCalUID),
    ) ??
    candidates[0] ??
    null;
  if (existing) {
    if (existing.organizerId === input.actorId || existing.participantUserIds.includes(input.actorId)) {
      return { ok: true, meeting: { id: existing.id } };
    }
    if (event.viewerInvited || labWide) {
      const updated = await prisma.scheduledMeeting.update({
        where: { id: existing.id },
        data: { participantUserIds: { push: input.actorId } },
      });
      await ensureOccurrenceRoster(updated, startDate);
      await syncMeetingShares(updated.id);
      return { ok: true, meeting: { id: updated.id } };
    }
    return { ok: false, error: "This event is already tracked in DALI", status: 409 };
  }

  // The roster starts as Google's organizer plus guests, resolved to DALI
  // members. An event on the general calendar often has no guest list at
  // all, and that's fine — the roster is editable on the meeting page, and the
  // actor is always on it.
  const attendeeEmails = Array.from(
    new Set(
      [...event.attendeeEmails, ...(event.organizerEmail ? [event.organizerEmail] : [])].map((e) =>
        e.toLowerCase(),
      ),
    ),
  );
  const attendees = attendeeEmails.length
    ? await prisma.user.findMany({
        where: {
          daliMember: { isNot: null },
          OR: [
            { daliEmail: { in: attendeeEmails, mode: "insensitive" } },
            { dartmouthEmail: { in: attendeeEmails, mode: "insensitive" } },
          ],
        },
        select: { id: true, daliEmail: true, dartmouthEmail: true },
      })
    : [];
  const participantUserIds = attendees
    .map((u) => u.id)
    .filter((id) => id !== input.actorId);
  // Everyone else on the Google event stays on it as an email guest, so editing
  // the tracked meeting later doesn't strip them from Google's guest list.
  const guestEmails = normalizeGuestEmails(
    attendeeEmails,
    attendees.flatMap((u) => [u.daliEmail, u.dartmouthEmail].filter((e): e is string => !!e)),
  );

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
      // the meeting page reads to let any lab member see a lab-wide meeting,
      // which is right for the general calendar and wrong for anyone's own
      // event: that one stays with the people on it.
      scopeType: labWide ? "None" : "UserList",
      participantUserIds,
      guestEmails,
      selectedAt: startDate,
      status: "Confirmed",
      externalEventId,
      iCalUID: event.iCalUID,
      googleEventOrigin: "Tracked",
      recurrenceRule: event.recurrence[0]?.replace(/^RRULE:/, "") ?? null,
      ownerCalendarEmail: link.externalEmail,
      organizerCalendarLinkId: link.id,
      organizerCalendarId: input.calendarId,
    },
  });

  // The roster the attendance checklist reads. The actor is always present on
  // it so the meeting page is never an empty shell.
  await seedMeetingRoster({
    id: meeting.id,
    organizerId: input.actorId,
    participantUserIds,
    selectedAt: startDate,
    createdAt: meeting.createdAt,
  });

  return { ok: true, meeting };
}

/**
 * The public create/update/cancel entry points. Each can change the organizer's
 * and every internal attendee's Google calendar, so a success stamps them all
 * and no caller (route, MCP tool, partner flow) has to remember to.
 */
export async function createScheduledMeeting(
  input: CreateScheduledMeetingInput,
): Promise<CreateScheduledMeetingResult> {
  const result = await createScheduledMeetingImpl(input);
  if (result.ok) {
    await markCalendarChanged(result.meeting.organizerId, result.meeting.participantUserIds ?? []);
  }
  return result;
}

export async function updateScheduledMeeting(
  meetingId: string,
  actorUserId: string,
  input: UpdateScheduledMeetingInput,
): Promise<UpdateScheduledMeetingResult> {
  const result = await updateScheduledMeetingImpl(meetingId, actorUserId, input);
  if (result.ok) {
    await markCalendarChanged(actorUserId, [result.meeting.organizerId, ...(result.meeting.participantUserIds ?? [])]);
  }
  return result;
}

export async function cancelScheduledMeeting(
  meetingId: string,
  actorUserId: string,
  opts?: Parameters<typeof cancelScheduledMeetingImpl>[2],
): Promise<CancelScheduledMeetingResult> {
  const result = await cancelScheduledMeetingImpl(meetingId, actorUserId, opts);
  if (result.ok && !result.alreadyCancelled) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: meetingId },
      select: { organizerId: true, participantUserIds: true },
    });
    await markCalendarChanged(actorUserId, [
      ...(meeting ? [meeting.organizerId, ...meeting.participantUserIds] : []),
    ]);
  }
  return result;
}
