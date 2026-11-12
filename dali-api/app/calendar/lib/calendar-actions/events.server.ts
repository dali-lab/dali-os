import { prisma } from "~/lib/db.server";
import { NotAGuestError, createGoogleCalendarEvent, deleteGoogleCalendarEvent, getGoogleEvent, patchGoogleCalendarEvent, respondToGoogleEventAsSelf } from "~/lib/google-calendar";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { type ScheduledMeetingScope, cancelScheduledMeeting, ownsGoogleEvent, updateScheduledMeeting } from "~/lib/scheduled-meeting";
import { followingRule, googleInstanceOriginalStart, rruleWithUntil } from "~/lib/meeting-occurrences";
import { bookRoomsForEvent, claimEventRoomBookings, releaseEventRoomBookings, releaseRoomBookings, retimeEventRoomBookings, truncateEventRoomBookings } from "~/rooms/lib/rooms.server";
import { resolveEventWorkLog, retimeEventWorkLog, workLogShapeError, writeEventWorkLog } from "~/calendar/lib/calendar-actions/event-work-log.server";
import { assertLinkOwned } from "~/calendar/lib/calendar-actions/shared.server";

type EventScope = "this" | "following" | "all";

const RSVP_RESPONSES = ["accepted", "declined", "tentative"] as const;
type RsvpResponse = (typeof RSVP_RESPONSES)[number];
const RSVP_ENUM: Record<RsvpResponse, "Accepted" | "Declined" | "Tentative"> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
};

/**
 * Answer an invite from the calendar page. The write goes to Google on the
 * viewer's own token, against their own copy of the event, so it works for any
 * invite they can see — and Google is what the grid re-reads, so it stays the
 * source of truth for the response.
 *
 * When the event is also a DALI meeting, the matching invite Notification is
 * brought along: otherwise answering here would leave the same invite sitting
 * unanswered in the task list.
 */
async function handleEventRsvp(opts: {
  userId: string;
  linkId: string;
  calendarId?: string;
  eventId: string;
  recurringEventId: string | null;
  response: string;
}): Promise<Response | null> {
  const { userId, linkId, calendarId, eventId, recurringEventId } = opts;
  if (!eventId) return Response.json({ error: "Missing event id" }, { status: 400 });
  if (!RSVP_RESPONSES.includes(opts.response as RsvpResponse)) {
    return Response.json({ error: "Unknown response" }, { status: 400 });
  }
  const response = opts.response as RsvpResponse;
  try {
    await respondToGoogleEventAsSelf({ linkId, calendarId, eventId, response });
  } catch (err) {
    if (err instanceof NotAGuestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  // The series master is what a meeting records, so an instance answers for the
  // meeting it belongs to.
  const meeting = await prisma.scheduledMeeting.findFirst({
    where: {
      externalEventId: { in: recurringEventId ? [eventId, recurringEventId] : [eventId] },
    },
    select: { id: true },
  });
  if (meeting) {
    const { count } = await prisma.notification.updateMany({
      where: { scheduledMeetingId: meeting.id, recipientUserId: userId },
      data: { rsvp: RSVP_ENUM[response], rsvpAt: new Date(), readAt: new Date() },
    });
    // Converge the desktop badge rather than waiting for its sync backstop.
    if (count > 0) publishNotificationChange([userId]);
  }
  return null;
}

// Create / edit / move / delete a Google Calendar event. `destination` is "linkId:calendarId". Times arrive as ISO (timed) or a
// date (all-day, end exclusive). For recurring events the `scope` (this /
// following / all) decides whether we touch the instance, the master, or split
// the series.
/** Parse the composer's guest scope (JSON) back into a ScheduledMeetingScope,
 *  normalizing anything unexpected to "None" (no guests) rather than trusting the
 *  wire shape. */
function parseMeetingScope(raw: string): ScheduledMeetingScope {
  const p = JSON.parse(raw) as {
    type?: string;
    groupId?: unknown;
    extraUserIds?: unknown;
    participantUserIds?: unknown;
  };
  if (p?.type === "Group" && typeof p.groupId === "string") {
    return {
      type: "Group",
      groupId: p.groupId,
      extraUserIds: Array.isArray(p.extraUserIds) ? (p.extraUserIds as string[]) : undefined,
    };
  }
  if (p?.type === "UserList" && Array.isArray(p.participantUserIds)) {
    return { type: "UserList", participantUserIds: p.participantUserIds as string[] };
  }
  return { type: "None" };
}

/**
 * When the event being edited from the composer is a DALI meeting, edit it
 * through updateScheduledMeeting instead of a raw Google patch: that reconciles
 * the attendance roster, notifies added/removed guests, and re-syncs the Google
 * event — all under organizer-or-Core auth, which also lets Core edit a meeting
 * on a calendar they don't own. So this runs before the link-ownership gate.
 * Returns "passthrough" when the event isn't a manageable meeting.
 */
async function maybeUpdateMeetingFromComposer(
  userId: string,
  get: (k: string) => string,
): Promise<Response | null | "passthrough"> {
  const eventId = get("eventId");
  if (!eventId) return "passthrough";
  const recurringEventId = get("recurringEventId") || null;
  const externalIds = recurringEventId ? [eventId, recurringEventId] : [eventId];
  const meeting = await prisma.scheduledMeeting.findFirst({
    where: { externalEventId: { in: externalIds }, status: { not: "Cancelled" } },
    select: { id: true, recurrenceRule: true },
  });
  if (!meeting) return "passthrough";

  const title = get("title").trim();
  if (!title) return Response.json({ error: "Give the event a title." }, { status: 400 });
  const startIso = get("startIso");
  const endIso = get("endIso");
  if (!startIso || !endIso) return Response.json({ error: "Set a start and end." }, { status: 400 });
  const durationMinutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (!(durationMinutes > 0)) return Response.json({ error: "End must be after start." }, { status: 400 });

  let scope: ScheduledMeetingScope;
  try {
    scope = parseMeetingScope(get("meetingScope") || '{"type":"None"}');
  } catch {
    return Response.json({ error: "Couldn't read the guest list." }, { status: 400 });
  }

  // Absent when the composer had no guest list to edit — leave the stored ones.
  let guestEmails: string[] | undefined;
  if (get("guestEmails")) {
    try {
      const parsed: unknown = JSON.parse(get("guestEmails"));
      guestEmails = Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
    } catch {
      return Response.json({ error: "Couldn't read the guest list." }, { status: 400 });
    }
  }

  const editScope = (get("scope") || "all") as "this" | "following" | "all";
  const occurrenceStart = get("originalStartIso") || undefined;
  const occurrenceEventId = get("eventId") || undefined;

  // For "all" we pass the recurrenceRule from the master (cadence unchanged).
  // For "this"/"following" the handlers in updateScheduledMeeting manage the rule.
  const recurrenceRule = editScope === "all" ? meeting.recurrenceRule : undefined;

  const result = await updateScheduledMeeting(meeting.id, userId, {
    title,
    durationMinutes,
    scope,
    startTime: startIso,
    recurrenceRule,
    location: get("location").trim(),
    description: get("description").trim(),
    guestEmails,
    editScope,
    occurrenceStart,
    occurrenceEventId,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  // "Count this as work" logs the viewer's own hours against the event.
  // Skip for any scoped edit that isn't a plain single-event save.
  if (!recurringEventId && editScope === "all") {
    const [linkId] = get("destination").split(":");
    const ownsLink = linkId
      ? Boolean(
          await prisma.userCalendarLink.findFirst({
            where: { id: linkId, userId },
            select: { id: true },
          }),
        )
      : false;
    if (ownsLink) {
      const work = await resolveEventWorkLog(userId, get);
      if (work.error) return work.error;
      if (work.work.kind === "write") {
        const shapeError = workLogShapeError(null, get("allDay") === "1");
        if (shapeError) return shapeError;
      }
      await writeEventWorkLog({ userId, eventId, linkId, title, startIso, endIso, work: work.work });
    }
  }
  return null;
}

/**
 * A drag-move of a meeting's event writes the occurrence's MeetingException
 * (updateScheduledMeeting scope "this") so DALI's own surfaces move with the
 * grid. Returns whether Google was already patched by that path; null when the
 * event isn't a manageable meeting, so the caller moves it with a raw patch.
 */
async function moveMeetingOccurrence(
  userId: string,
  input: { eventId: string; recurringEventId: string | null; startIso: string; endIso: string },
): Promise<{ googlePatched: boolean } | { error: string; status: number } | null> {
  const externalIds = input.recurringEventId ? [input.eventId, input.recurringEventId] : [input.eventId];
  const meeting = await prisma.scheduledMeeting.findFirst({
    where: { externalEventId: { in: externalIds }, status: { not: "Cancelled" } },
    select: { id: true, title: true, selectedAt: true, externalEventId: true, googleEventOrigin: true },
  });
  if (!meeting) return null;
  const occurrenceStart =
    googleInstanceOriginalStart(input.eventId, input.recurringEventId) ?? meeting.selectedAt;
  if (!occurrenceStart) return null;
  const durationMinutes = Math.round(
    (new Date(input.endIso).getTime() - new Date(input.startIso).getTime()) / 60_000,
  );
  const existing = await prisma.meetingException.findUnique({
    where: {
      scheduledMeetingId_originalStart: { scheduledMeetingId: meeting.id, originalStart: occurrenceStart },
    },
    select: { overrideTitle: true },
  });
  const result = await updateScheduledMeeting(meeting.id, userId, {
    title: existing?.overrideTitle ?? meeting.title,
    durationMinutes,
    scope: { type: "None" },
    startTime: input.startIso,
    editScope: "this",
    occurrenceStart: occurrenceStart.toISOString(),
    occurrenceEventId: input.eventId,
  });
  if (!result.ok) {
    return result.status === 403 ? null : { error: result.error, status: result.status };
  }
  return { googlePatched: ownsGoogleEvent(meeting) };
}

async function maybeCancelMeetingFromComposer(
  userId: string,
  get: (k: string) => string,
): Promise<Response | null | "passthrough"> {
  const eventId = get("eventId");
  if (!eventId) return "passthrough";
  const recurringEventId = get("recurringEventId") || null;
  const externalIds = recurringEventId ? [eventId, recurringEventId] : [eventId];
  const meeting = await prisma.scheduledMeeting.findFirst({
    where: { externalEventId: { in: externalIds }, status: { not: "Cancelled" } },
    select: { id: true },
  });
  if (!meeting) return "passthrough";

  const deleteScope = (get("scope") || "all") as "this" | "following" | "all";
  const occurrenceStart = get("originalStartIso") || undefined;

  const result = await cancelScheduledMeeting(meeting.id, userId, {
    allowCore: true,
    scope: deleteScope,
    occurrenceStart,
    occurrenceEventId: eventId,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return null;
}

export async function handleEventAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  // A meeting-backed event is edited through its own DALI update path (roster +
  // notifications + Google sync), before the link-ownership gate below.
  if (intent === "event-update") {
    const handled = await maybeUpdateMeetingFromComposer(userId, get);
    if (handled !== "passthrough") return handled;
  }
  if (intent === "event-delete") {
    const handled = await maybeCancelMeetingFromComposer(userId, get);
    if (handled !== "passthrough") return handled;
  }
  const dest = get("destination");
  const [linkId, calRaw] = dest.split(":");
  const calendarId = calRaw || undefined;
  const scope = (get("scope") || "this") as EventScope;
  const recurringEventId = get("recurringEventId") || null;
  const originalStartIso = get("originalStartIso") || null;
  try {
    if (!linkId) return Response.json({ error: "Pick a calendar." }, { status: 400 });
    await assertLinkOwned(userId, linkId);

    if (intent === "event-rsvp") {
      return await handleEventRsvp({
        userId,
        linkId,
        calendarId,
        eventId: get("eventId"),
        recurringEventId,
        response: get("response"),
      });
    }

    if (intent === "event-delete") {
      const eventId = get("eventId");
      if (!eventId) return Response.json({ error: "Missing event" }, { status: 400 });
      if (recurringEventId && scope === "all") {
        await deleteGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId });
      } else if (recurringEventId && scope === "following" && originalStartIso) {
        // Truncate the series: master ends just before this occurrence.
        const master = await getGoogleEvent({ linkId, calendarId, eventId: recurringEventId });
        const rule = rruleWithUntil(master.recurrence, new Date(new Date(originalStartIso).getTime() - 1000));
        if (rule) await patchGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId, recurrenceRule: rule });
      } else {
        await deleteGoogleCalendarEvent({ linkId, calendarId, eventId }); // this occurrence
      }
      // The hours were the event's hours — they go with it rather than being
      // left behind as an entry pointing at an event that no longer exists.
      // Same for any room it held. The hold is keyed by the series master for
      // a recurring event, not the instance id.
      await prisma.timeEntry.deleteMany({ where: { userId, sourceEventId: eventId } });
      const holdKey = recurringEventId ?? eventId;
      const occurrenceStart =
        googleInstanceOriginalStart(eventId, recurringEventId) ??
        (originalStartIso ? new Date(originalStartIso) : undefined);
      // Google deletion already happened above; there's nothing to roll back
      // if this fails, so its result is ignored.
      await releaseEventRoomBookings(userId, holdKey, { scope: recurringEventId ? scope : "all", occurrenceStart });
      return null;
    }

    const title = get("title").trim();
    const startIso = get("startIso");
    const endIso = get("endIso");
    if (!startIso || !endIso) return Response.json({ error: "Set a start and end." }, { status: 400 });
    const allDay = get("allDay") === "1";
    const timeZone = get("timeZone").trim() || undefined;

    // Drag move/resize: patch just this event/occurrence's time.
    if (intent === "event-move") {
      const eventId = get("eventId");
      if (!eventId) return Response.json({ error: "Missing event id" }, { status: 400 });
      // Rooms first: a taken room rejects the move before Google hears of it.
      const moved = await retimeEventRoomBookings({
        userId,
        sourceEventId: recurringEventId ?? eventId,
        start: new Date(startIso),
        end: new Date(endIso),
        scope: recurringEventId ? "this" : "all",
        occurrenceStart: googleInstanceOriginalStart(eventId, recurringEventId) ?? undefined,
      });
      if (!moved.ok) return Response.json({ error: moved.error }, { status: moved.status });
      const meetingMove = allDay ? null : await moveMeetingOccurrence(userId, { eventId, recurringEventId, startIso, endIso });
      if (meetingMove && "error" in meetingMove) {
        return Response.json({ error: meetingMove.error }, { status: meetingMove.status });
      }
      if (!meetingMove?.googlePatched) {
        await patchGoogleCalendarEvent({ linkId, calendarId, eventId, startIso, endIso, allDay, timeZone });
      }
      await retimeEventWorkLog(userId, eventId, startIso, endIso);
      return null;
    }

    if (!title) return Response.json({ error: "Give the event a title." }, { status: 400 });
    const description = get("description").trim();
    const location = get("location").trim();

    if (intent === "event-create") {
      const recurrenceRule = get("recurrenceRule").trim() || null;
      // Resolved before the Google write: a role we can't resolve should fail
      // the save outright, not leave an untracked event on the calendar.
      const work = await resolveEventWorkLog(userId, get);
      if (work.error) return work.error;
      if (work.work.kind === "write") {
        const shapeError = workLogShapeError(recurrenceRule, allDay);
        if (shapeError) return shapeError;
      }

      // "Count this as work" ADDS hours to an event — it doesn't replace it.
      // The event lands on the chosen destination either way; the linked entry
      // rides along, and the grid draws that one block with a role accent
      // rather than a second, overlapping logged-time block.
      // Rooms picked in the Location field. A plain event has no
      // ScheduledMeeting to claim them, so it takes a RoomBooking per room —
      // before the Google write, so a room that's taken rejects the save.
      const roomIds = [...new Set(get("roomIds").split(",").filter(Boolean))];
      let bookingIds: string[] = [];
      if (roomIds.length) {
        if (allDay) {
          return Response.json(
            { error: "A room can only be booked for an event with a start and end time." },
            { status: 400 },
          );
        }
        const booked = await bookRoomsForEvent({
          roomIds,
          userId,
          start: new Date(startIso),
          end: new Date(endIso),
          title,
          recurrenceRule,
        });
        if (!booked.ok) return Response.json({ error: booked.error }, { status: booked.status });
        bookingIds = booked.value;
      }

      let created: Awaited<ReturnType<typeof createGoogleCalendarEvent>>;
      try {
        created = await createGoogleCalendarEvent({
          linkId,
          calendarId,
          summary: title,
          description: description || undefined,
          location: location || undefined,
          startIso,
          endIso,
          allDay,
          recurrenceRule,
          timeZone,
          attendees: [],
        });
      } catch (err) {
        await releaseRoomBookings(bookingIds);
        throw err;
      }
      await claimEventRoomBookings(bookingIds, created.eventId);
      await writeEventWorkLog({
        userId,
        eventId: created.eventId,
        linkId,
        title,
        startIso,
        endIso,
        work: work.work,
      });
      return null;
    }

    if (intent === "event-update") {
      const eventId = get("eventId");
      if (!eventId) return Response.json({ error: "Missing event id" }, { status: 400 });
      // addMeet mints a Meet link on an event saved without one; it rides the
      // shared fields so every patch path below carries it.
      const addMeet = get("addMeet") === "1";
      const fields = {
        summary: title,
        description,
        location,
        allDay,
        timeZone,
        ...(addMeet ? { addMeet: true } : {}),
      };
      // Same order as create: validate the work half before touching Google.
      // A recurring edit can patch the master or split the series, so there's
      // no single occurrence to key a log on — the composer hides the toggle
      // for repeats, and those events are left out of the work write below.
      const work = await resolveEventWorkLog(userId, get);
      if (work.error) return work.error;
      if (work.work.kind === "write" && !recurringEventId) {
        const shapeError = workLogShapeError(null, allDay);
        if (shapeError) return shapeError;
      }

      if (recurringEventId && scope === "all") {
        // Series duration follows the new start/end; rooms first so a taken
        // room rejects the edit before Google hears of it.
        const moved = await retimeEventRoomBookings({
          userId,
          sourceEventId: recurringEventId,
          start: new Date(startIso),
          end: new Date(endIso),
          scope: "all",
        });
        if (!moved.ok) return Response.json({ error: moved.error }, { status: moved.status });
        // Whole series — patch the master (also moves its anchor time).
        await patchGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId, startIso, endIso, ...fields });
      } else if (recurringEventId && scope === "following" && originalStartIso) {
        // Split: truncate the master before this occurrence, then start a new
        // series from the edited fields. Any live holds on the master split
        // the same way: truncate first, THEN book the new series — booking
        // first would see the old series' own (not-yet-truncated) occurrences
        // on the same rooms and reject with a false conflict.
        const master = await getGoogleEvent({ linkId, calendarId, eventId: recurringEventId });
        const holds = await prisma.roomBooking.findMany({
          where: { userId, sourceEventId: recurringEventId, cancelledAt: null },
          select: { roomId: true, seriesEnd: true },
        });
        const splitAt = googleInstanceOriginalStart(eventId, recurringEventId) ?? new Date(originalStartIso);
        let newBookingIds: string[] = [];
        if (holds.length) {
          const truncatedHolds = await truncateEventRoomBookings(userId, recurringEventId, splitAt);
          if (!truncatedHolds.ok) return Response.json({ error: truncatedHolds.error }, { status: truncatedHolds.status });
          // The new hold series keeps the old one's end rather than the
          // master's rule verbatim: a COUNT would start over and run past the
          // term the old holds were approved for.
          const oldSeriesEnd = holds.reduce<Date | null>(
            (acc, h) => (h.seriesEnd && (!acc || h.seriesEnd > acc) ? h.seriesEnd : acc),
            null,
          );
          const recurrenceRule = oldSeriesEnd ? rruleWithUntil(master.recurrence, oldSeriesEnd) : null;
          const booked = await bookRoomsForEvent({
            roomIds: [...new Set(holds.map((h) => h.roomId))],
            userId,
            start: new Date(startIso),
            end: new Date(endIso),
            title,
            recurrenceRule,
          });
          if (!booked.ok) return Response.json({ error: booked.error }, { status: booked.status });
          newBookingIds = booked.value;
        }
        const truncatedRule = rruleWithUntil(master.recurrence, new Date(new Date(originalStartIso).getTime() - 1000));
        if (truncatedRule) await patchGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId, recurrenceRule: truncatedRule });
        let newEvent: Awaited<ReturnType<typeof createGoogleCalendarEvent>>;
        try {
          newEvent = await createGoogleCalendarEvent({
            linkId,
            calendarId,
            summary: title,
            description: description || undefined,
            location: location || undefined,
            startIso,
            endIso,
            allDay,
            recurrenceRule: followingRule(master.recurrence, new Date(master.startIso ?? master.startDate ?? splitAt), splitAt),
            timeZone,
            attendees: [],
            addMeet: addMeet || undefined,
          });
        } catch (err) {
          await releaseRoomBookings(newBookingIds);
          throw err;
        }
        await claimEventRoomBookings(newBookingIds, newEvent.eventId);
      } else {
        // This occurrence (or a plain single event) — its hold moves with it
        // or blocks the edit.
        const moved = await retimeEventRoomBookings({
          userId,
          sourceEventId: recurringEventId ?? eventId,
          start: new Date(startIso),
          end: new Date(endIso),
          scope: recurringEventId ? "this" : "all",
          occurrenceStart: recurringEventId
            ? googleInstanceOriginalStart(eventId, recurringEventId) ?? new Date(originalStartIso ?? startIso)
            : undefined,
        });
        if (!moved.ok) return Response.json({ error: moved.error }, { status: moved.status });
        await patchGoogleCalendarEvent({ linkId, calendarId, eventId, startIso, endIso, ...fields });
      }
      if (!recurringEventId) {
        await writeEventWorkLog({ userId, eventId, linkId, title, startIso, endIso, work: work.work });
      }
      return null;
    }
    return Response.json({ error: "Unknown event action" }, { status: 400 });
  } catch (err) {
    console.error("event action failed", err);
    const msg = err instanceof Error && err.message.includes("connected") ? err.message : "Couldn't save to Google Calendar.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
