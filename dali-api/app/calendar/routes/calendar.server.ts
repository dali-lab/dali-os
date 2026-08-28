import { prisma } from "~/lib/db";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { fullName } from "~/lib/display";
import { listAllGroups } from "~/lib/groups";
import {
  canViewForms,
  isCore,
  currentTerm,
  currentTermMemberWhere,
  getUserRoleInstances,
  getUserRoles,
  resolveRoleRef,
  type RoleInstance,
} from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  createClass,
  updateClass,
  removeClass,
  parseDestination,
  toMemberClassDTO,
  buildClassDestinations,
  MemberClassError,
} from "~/lib/member-class.server";
import { expandClassOccurrences } from "~/calendar/lib/class-schedule";
import type { PeriodMeeting } from "~/calendar/lib/dartmouth-periods";
import { CalendarActionSchema, validateTimeEntryRange } from "~/lib/calendar-schemas";
import { syncManualBlockTimeEntry } from "~/lib/time-entry-sync";
import {
  fetchBusyEvents,
  fetchCalendarEvents,
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleEvent,
  createCalendar,
  patchCalendar,
  deleteCalendar,
  getValidAccessTokenForLink,
  listCalendarsForLink,
  subscribeCalendarForLink,
  type CalendarEvent,
} from "~/lib/google-calendar";
import {
  generalCalendarId,
  generalCalendarState,
} from "~/lib/general-calendar";
import { getZonedYMD, resolveUserTimeZone, zonedDayStartUtc } from "~/lib/timezone";
import type {
  WhSegment,
  WhDay,
  ManualBlockDTO,
  SubCalendarDTO,
  CalendarLinkDTO,
  GroupOption,
  UserOption,
  ProjectOption,
  TimeEntryDTO,
  MeetingInviteDTO,
  MemberClassDTO,
  ClassOccurrenceDTO,
  ClassDestinationDTO,
  ExternalEventDTO,
  EventAttendeeDTO,
  EventLinkDTO,
  LoaderData,
  EventBlock,
  GroupAvailDay,
  PerUserFree,
  GroupAvailResponse,
  CalendarView,
} from "~/calendar/lib/types";
import {
  defaultWorkingHours,
  DEFAULT_BUFFER_MIN,
  EVENT_DURATION_OPTIONS,
  DEFAULT_EVENT_DURATION_MIN,
} from "~/calendar/lib/calendar-defaults";

// Google's responseStatus vocabulary → the labels the detail popover shows,
// shared with the DALI-native RSVP wording so one guest list reads the same
// whichever calendar the event came from.
const GOOGLE_RSVP_LABEL: Record<
  "accepted" | "declined" | "tentative" | "needsAction",
  EventAttendeeDTO["status"]
> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  needsAction: "Pending",
};

// Shared external-event → DTO mappers (both the busy read and the full
// calendar-crud read produce the same attendee/link shapes).
function externalAttendees(
  atts: { name: string; responseStatus: "accepted" | "declined" | "tentative" | "needsAction"; organizer?: boolean; optional?: boolean }[] | undefined,
): EventAttendeeDTO[] | undefined {
  return atts?.map((a) => ({
    name: a.name,
    status: GOOGLE_RSVP_LABEL[a.responseStatus],
    organizer: a.organizer,
    optional: a.optional,
  }));
}
function externalLinks(meetingUrl?: string, htmlLink?: string): EventLinkDTO[] {
  return [
    ...(meetingUrl ? [{ label: "Join video call", href: meetingUrl }] : []),
    ...(htmlLink ? [{ label: "Open in Google Calendar", href: htmlLink }] : []),
  ];
}

function userDisplayName(
  u: { firstName: string | null; lastName: string | null; daliEmail: string | null } | undefined,
): string | null {
  if (!u) return null;
  return fullName(u) || u.daliEmail || null;
}

// Window for the visible week grid. We compute Sunday→following Sunday in the
// user's timezone (the grid renders Sun..Sat columns). When `anchor` is provided
// it picks the Sunday of that date's week; otherwise it uses "now".
function weekWindow(timezone: string, anchor?: Date): { start: Date; end: Date } {
  const ref = anchor ?? new Date();
  const ymd = getZonedYMD(ref, timezone);
  const refUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = refUtcMidnight.getUTCDay();
  const sundayUtc = new Date(refUtcMidnight.getTime() - dow * 86_400_000);
  const start = zonedDayStartUtc(
    sundayUtc.getUTCFullYear(),
    sundayUtc.getUTCMonth() + 1,
    sundayUtc.getUTCDate(),
    timezone,
  );
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const end = zonedDayStartUtc(
    nextSundayUtc.getUTCFullYear(),
    nextSundayUtc.getUTCMonth() + 1,
    nextSundayUtc.getUTCDate(),
    timezone,
  );
  return { start, end };
}

function parseView(v: string | null): CalendarView {
  return v === "day" || v === "month" || v === "agenda" ? v : "week";
}

// Window for the unified screen's active view. Day = the anchor's calendar day;
// Week = weekWindow (Sun..Sun); Month = the Sunday on/before the 1st .. the
// Sunday after the last day (the 5–6 week month grid). Boundaries snap through
// zonedDayStartUtc so they stay DST-correct in the user's timezone, matching
// weekWindow.
function viewWindow(timezone: string, view: CalendarView, anchor?: Date): { start: Date; end: Date } {
  if (view === "week") return weekWindow(timezone, anchor);
  const ymd = getZonedYMD(anchor ?? new Date(), timezone);
  const snap = (utcMidnight: Date) =>
    zonedDayStartUtc(utcMidnight.getUTCFullYear(), utcMidnight.getUTCMonth() + 1, utcMidnight.getUTCDate(), timezone);
  if (view === "day") {
    const start = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, timezone);
    const end = snap(new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day) + 86_400_000));
    return { start, end };
  }
  // month
  const firstUtc = new Date(Date.UTC(ymd.year, ymd.month - 1, 1));
  const gridStartUtc = new Date(firstUtc.getTime() - firstUtc.getUTCDay() * 86_400_000);
  const lastUtc = new Date(Date.UTC(ymd.year, ymd.month, 0)); // day 0 of next month = this month's last day
  const gridEndUtc = new Date(lastUtc.getTime() + (7 - lastUtc.getUTCDay()) * 86_400_000); // Sunday after the last day
  return { start: snap(gridStartUtc), end: snap(gridEndUtc) };
}

/** Read a single cookie value from the request's Cookie header. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function parseDurationCookie(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  return (EVENT_DURATION_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_EVENT_DURATION_MIN;
}

function hhmmToMinute(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// A custom (non-period) class: a single main meeting from picked weekdays + a
// start/end time. The client submits weekdays as a "1,3,5" getDay() list.
function parseCustomMeetings(raw: Record<string, FormDataEntryValue>): PeriodMeeting[] | undefined {
  const daysStr = typeof raw.customDays === "string" ? raw.customDays : "";
  const days = daysStr
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const startMin = hhmmToMinute(typeof raw.customStart === "string" ? raw.customStart : "");
  const endMin = hhmmToMinute(typeof raw.customEnd === "string" ? raw.customEnd : "");
  if (days.length === 0 || startMin === null || endMin === null || endMin <= startMin) return undefined;
  return [{ kind: "main", days, startMin, endMin }];
}

// Add / edit / remove a class. The term is resolved server-side (not trusted
// from the form) so a class can only land on the current term.
async function handleClassAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  try {
    if (intent === "class-remove") {
      const classId = get("classId");
      if (!classId) return Response.json({ error: "Missing class id" }, { status: 400 });
      await removeClass(userId, classId);
      return null;
    }

    const term = await currentTerm(request);
    if (!term) return Response.json({ error: "There's no active term to add classes to." }, { status: 400 });

    const title = get("title").trim();
    if (!title) return Response.json({ error: "Give the class a name." }, { status: 400 });
    const location = get("location").trim() || null;
    const destination = parseDestination(get("destination") || "local");
    const periodCode = get("periodCode").trim() || null;
    const includeXHour = get("includeXHour") === "1" || get("includeXHour") === "on";
    let customMeetings: PeriodMeeting[] | undefined;
    if (!periodCode) {
      customMeetings = parseCustomMeetings(raw);
      if (!customMeetings) {
        return Response.json({ error: "Pick a class period, or set a custom day and time." }, { status: 400 });
      }
    }

    const params = { userId, termId: term.id, title, location, periodCode, includeXHour, customMeetings, destination };
    if (intent === "class-add") {
      await createClass(params);
    } else if (intent === "class-update") {
      const classId = get("classId");
      if (!classId) return Response.json({ error: "Missing class id" }, { status: 400 });
      await updateClass(classId, params);
    } else {
      return Response.json({ error: "Unknown class action" }, { status: 400 });
    }
    return null;
  } catch (err) {
    if (err instanceof MemberClassError) return Response.json({ error: err.message }, { status: 400 });
    console.error("class action failed", err);
    return Response.json(
      { error: "Couldn't save the class. If it syncs to Google, check that calendar is still connected." },
      { status: 500 },
    );
  }
}

async function assertLinkOwned(userId: string, linkId: string): Promise<void> {
  const link = await prisma.userCalendarLink.findFirst({
    where: { id: linkId, userId, provider: "Google" },
    select: { id: true },
  });
  if (!link) throw new Error("That calendar isn't connected to your account.");
}

/** RRULE UTC "UNTIL" in basic format (YYYYMMDDTHHMMSSZ). */
function rruleUntilBasic(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
/** Take a recurring master's `recurrence` array and return one RRULE string with
 *  UNTIL set (existing UNTIL/COUNT stripped) — for splitting/truncating a series. */
function rruleWithUntil(recurrence: string[], until: Date): string | null {
  const rule = recurrence.map((r) => r.replace(/^RRULE:/i, "")).find((r) => /FREQ=/i.test(r));
  if (!rule) return null;
  const parts = rule.split(";").filter((p) => !/^(UNTIL|COUNT)=/i.test(p));
  parts.push(`UNTIL=${rruleUntilBasic(until)}`);
  return parts.join(";");
}
function bareRrule(recurrence: string[]): string | null {
  const rule = recurrence.map((r) => r.replace(/^RRULE:/i, "")).find((r) => /FREQ=/i.test(r));
  return rule ? rule.split(";").filter((p) => !/^UNTIL=/i.test(p)).join(";") : null;
}

type EventScope = "this" | "following" | "all";

// In-app destination sentinel — kept local so handleEventAction can reference it
// without importing from the client-side calendar.tsx.
const LOCAL_DEST = "local";

// Create / edit / move / delete a Google Calendar event (calendar-google-crud
// flag). `destination` is "linkId:calendarId". Times arrive as ISO (timed) or a
// date (all-day, end exclusive). For recurring events the `scope` (this /
// following / all) decides whether we touch the instance, the master, or split
// the series.
async function handleEventAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("calendar-google-crud", userId, roles, request))) {
    return Response.json({ error: "Not enabled" }, { status: 403 });
  }
  const dest = get("destination");
  const isLocalDest = dest === LOCAL_DEST;
  const [linkId, calRaw] = dest.split(":");
  const calendarId = calRaw || undefined;
  const scope = (get("scope") || "this") as EventScope;
  const recurringEventId = get("recurringEventId") || null;
  const originalStartIso = get("originalStartIso") || null;
  try {
    // In-app (DALI) creation is a ManualBlock; everything else needs a Google link.
    if (intent === "event-create" && isLocalDest) {
      const title = get("title").trim();
      const startIso = get("startIso");
      const endIso = get("endIso");
      if (!title) return Response.json({ error: "Give the event a title." }, { status: 400 });
      if (!startIso || !endIso) return Response.json({ error: "Set a start and end." }, { status: 400 });
      const allDay = get("allDay") === "1";
      const recurrenceRule = get("recurrenceRule").trim() || null;
      const isWork = get("isWork") === "1";
      const assignmentType = (get("assignmentType") || null) as RoleInstance["assignmentType"] | null;
      const roleRefId = get("roleRefId") || null;
      const workNote = get("workNote").trim() || null;
      if (isWork && recurrenceRule) {
        return Response.json({ error: "Recurring blocks can't be added to the timesheet yet." }, { status: 400 });
      }
      if (isWork && !workNote) {
        return Response.json({ error: "Add a timesheet description." }, { status: 400 });
      }
      const startTime = new Date(startIso);
      const endTime = new Date(endIso);
      const block = await prisma.manualBlock.create({
        data: { userId, title, startTime, endTime, allDay, recurrenceRule, isWork, assignmentType, roleRefId, workNote },
      });
      const sync = await syncManualBlockTimeEntry({
        manualBlockId: block.id,
        userId,
        isWork,
        assignmentType,
        roleRefId,
        title,
        workNote,
        startTime,
        endTime,
      });
      if (!sync.ok) return Response.json({ error: sync.error }, { status: 400 });
      return null;
    }

    // In-app block edit / move / delete — the same composer, editing a
    // ManualBlock through the local destination.
    const manualBlockId = get("manualBlockId") || null;
    if (isLocalDest && manualBlockId) {
      const block = await prisma.manualBlock.findUnique({ where: { id: manualBlockId } });
      if (!block || block.userId !== userId) return Response.json({ error: "Not found" }, { status: 404 });
      if (intent === "event-delete") {
        await prisma.$transaction([
          prisma.timeEntry.deleteMany({ where: { manualBlockId, userId } }),
          prisma.manualBlock.delete({ where: { id: manualBlockId } }),
        ]);
        return null;
      }
      const startIso = get("startIso");
      const endIso = get("endIso");
      if (!startIso || !endIso) return Response.json({ error: "Set a start and end." }, { status: 400 });
      const startTime = new Date(startIso);
      const endTime = new Date(endIso);
      if (intent === "event-move") {
        await prisma.manualBlock.update({ where: { id: manualBlockId }, data: { startTime, endTime } });
        await syncManualBlockTimeEntry({
          manualBlockId,
          userId,
          isWork: block.isWork,
          assignmentType: block.assignmentType,
          roleRefId: block.roleRefId,
          title: block.title,
          workNote: block.workNote,
          startTime,
          endTime,
        });
        return null;
      }
      if (intent === "event-update") {
        const title = get("title").trim();
        if (!title) return Response.json({ error: "Give the event a title." }, { status: 400 });
        const isWork = get("isWork") === "1";
        const assignmentType = (get("assignmentType") || null) as RoleInstance["assignmentType"] | null;
        const roleRefId = get("roleRefId") || null;
        const workNote = get("workNote").trim() || null;
        const allDay = get("allDay") === "1";
        if (isWork && !workNote) {
          return Response.json({ error: "Add a timesheet description." }, { status: 400 });
        }
        await prisma.manualBlock.update({
          where: { id: manualBlockId },
          data: { title, startTime, endTime, allDay, isWork, assignmentType, roleRefId, workNote },
        });
        const sync = await syncManualBlockTimeEntry({
          manualBlockId,
          userId,
          isWork,
          assignmentType,
          roleRefId,
          title,
          workNote,
          startTime,
          endTime,
        });
        if (!sync.ok) return Response.json({ error: sync.error }, { status: 400 });
        return null;
      }
    }

    if (!linkId) return Response.json({ error: "Pick a calendar." }, { status: 400 });
    await assertLinkOwned(userId, linkId);

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
      await patchGoogleCalendarEvent({ linkId, calendarId, eventId, startIso, endIso, allDay, timeZone });
      return null;
    }

    if (!title) return Response.json({ error: "Give the event a title." }, { status: 400 });
    const description = get("description").trim();
    const location = get("location").trim();

    if (intent === "event-create") {
      const recurrenceRule = get("recurrenceRule").trim() || null;
      await createGoogleCalendarEvent({
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
      return null;
    }

    if (intent === "event-update") {
      const eventId = get("eventId");
      if (!eventId) return Response.json({ error: "Missing event id" }, { status: 400 });
      const fields = { summary: title, description, location, allDay, timeZone };

      if (recurringEventId && scope === "all") {
        // Whole series — patch the master (also moves its anchor time).
        await patchGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId, startIso, endIso, ...fields });
      } else if (recurringEventId && scope === "following" && originalStartIso) {
        // Split: truncate the master before this occurrence, then start a new
        // series from the edited fields.
        const master = await getGoogleEvent({ linkId, calendarId, eventId: recurringEventId });
        const truncated = rruleWithUntil(master.recurrence, new Date(new Date(originalStartIso).getTime() - 1000));
        if (truncated) await patchGoogleCalendarEvent({ linkId, calendarId, eventId: recurringEventId, recurrenceRule: truncated });
        await createGoogleCalendarEvent({
          linkId,
          calendarId,
          summary: title,
          description: description || undefined,
          location: location || undefined,
          startIso,
          endIso,
          allDay,
          recurrenceRule: bareRrule(master.recurrence),
          timeZone,
          attendees: [],
        });
      } else {
        // This occurrence (or a plain single event).
        await patchGoogleCalendarEvent({ linkId, calendarId, eventId, startIso, endIso, ...fields });
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

/** Create / rename / recolor / delete a linked Google calendar (P4). */
async function handleCalendarAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("calendar-google-crud", userId, roles, request))) {
    return Response.json({ error: "Not enabled" }, { status: 403 });
  }
  const linkId = get("linkId");
  if (!linkId) return Response.json({ error: "Missing account" }, { status: 400 });
  try {
    await assertLinkOwned(userId, linkId);
    if (intent === "cal-create") {
      const summary = get("summary").trim();
      if (!summary) return Response.json({ error: "Name the calendar." }, { status: 400 });
      const calendarId = await createCalendar(linkId, summary);
      await subscribeCalendarForLink(linkId, calendarId).catch(() => {});
      // Enable it for display + writing.
      const link = await prisma.userCalendarLink.findUnique({ where: { id: linkId }, select: { subCalendarIds: true } });
      if (link) {
        const set = new Set(link.subCalendarIds);
        set.add(calendarId);
        await prisma.userCalendarLink.update({ where: { id: linkId }, data: { subCalendarIds: [...set] } });
      }
      return null;
    }
    if (intent === "cal-rename") {
      const calendarId = get("calendarId");
      const summary = get("summary").trim();
      if (!calendarId || !summary) return Response.json({ error: "Missing calendar or name." }, { status: 400 });
      await patchCalendar({ linkId, calendarId, summary });
      return null;
    }
    if (intent === "cal-delete") {
      const calendarId = get("calendarId");
      if (!calendarId) return Response.json({ error: "Missing calendar." }, { status: 400 });
      await deleteCalendar(linkId, calendarId);
      return null;
    }
    return Response.json({ error: "Unknown calendar action" }, { status: 400 });
  } catch (err) {
    console.error("calendar action failed", err);
    const msg = err instanceof Error ? err.message : "Couldn't update the calendar.";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// FormData arrives as strings; convert to the typed shapes Zod expects.
function coerceFormToAction(raw: Record<string, FormDataEntryValue>): unknown {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const intent = get("intent");
  const asBool = (v: string | undefined) => v === "true";
  const asInt = (v: string | undefined) => (v === undefined ? undefined : parseInt(v, 10));

  switch (intent) {
    case "set-working-segments": {
      const segmentsRaw = get("segments");
      let segments: unknown = [];
      if (segmentsRaw) {
        try {
          segments = JSON.parse(segmentsRaw);
        } catch {
          // Leave as empty; zod will surface the validation error.
        }
      }
      return {
        intent,
        dayOfWeek: asInt(get("dayOfWeek")),
        segments,
      };
    }
    case "seed-working-hours": {
      const daysRaw = get("days");
      let days: unknown = [];
      if (daysRaw) {
        try {
          days = JSON.parse(daysRaw);
        } catch {
          // Leave empty; zod will surface the validation error.
        }
      }
      return { intent, days };
    }
    case "copy-weekdays":
    case "reset-working-hours":
      return { intent };
    case "set-event-buffer":
      return { intent, defaultEventBufferMin: asInt(get("defaultEventBufferMin")) };
    case "add-manual-block":
      return {
        intent,
        title: get("title"),
        startTime: get("startTime"),
        endTime: get("endTime"),
        allDay: get("allDay") ? asBool(get("allDay")) : false,
        recurrenceRule: get("recurrenceRule") || null,
        isWork: get("isWork") ? asBool(get("isWork")) : false,
        assignmentType: get("assignmentType") || null,
        roleRefId: get("roleRefId") || null,
      };
    case "update-manual-block":
      return {
        intent,
        id: get("id"),
        title: get("title"),
        startTime: get("startTime"),
        endTime: get("endTime"),
        allDay: get("allDay") === undefined ? undefined : asBool(get("allDay")),
        recurrenceRule:
          get("recurrenceRule") === undefined ? undefined : get("recurrenceRule") || null,
        isWork: get("isWork") === undefined ? undefined : asBool(get("isWork")),
        assignmentType:
          get("assignmentType") === undefined ? undefined : get("assignmentType") || null,
        roleRefId: get("roleRefId") === undefined ? undefined : get("roleRefId") || null,
      };
    case "remove-manual-block":
      return { intent, id: get("id") };
    case "remove-calendar-link":
      return { intent, linkId: get("linkId") };
    case "toggle-sub-calendar":
      return {
        intent,
        linkId: get("linkId"),
        calendarId: get("calendarId"),
        enabled: asBool(get("enabled")),
      };
    case "subscribe-general-calendar":
      return { intent, linkId: get("linkId") };
    case "add-time-entry":
      return {
        intent,
        date: get("date"),
        hours: get("hours") ? Number(get("hours")) : undefined,
        assignmentType: get("assignmentType") || null,
        roleRefId: get("roleRefId") || null,
        note: get("note") || null,
        startTime: get("startTime") || null,
        endTime: get("endTime") || null,
      };
    case "update-time-entry":
      return {
        intent,
        id: get("id"),
        date: get("date") || undefined,
        hours: get("hours") ? Number(get("hours")) : undefined,
        assignmentType:
          get("assignmentType") === undefined ? undefined : get("assignmentType") || null,
        roleRefId: get("roleRefId") === undefined ? undefined : get("roleRefId") || null,
        note: get("note") === undefined ? undefined : get("note") || null,
        startTime: get("startTime") === undefined ? undefined : get("startTime") || null,
        endTime: get("endTime") === undefined ? undefined : get("endTime") || null,
      };
    case "delete-time-entry":
      return { intent, id: get("id") };
    case "toggle-meeting-time-entry":
      return { intent, meetingId: get("meetingId"), onTimesheet: asBool(get("onTimesheet")) };
    case "set-meeting-core":
      return { intent, meetingId: get("meetingId"), isCoreMeeting: asBool(get("isCoreMeeting")) };
    default:
      return raw;
  }
}

export async function loadCalendarData(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const userId = auth.user.sub;

  // Resolve the current term once and reuse it everywhere in this loader so
  // the per-request cache in roles.ts eliminates redundant DB reads.
  const term = await currentTerm(request);
  const termId = term?.id;

  // Participant picker is for scheduling with current lab members — exclude
  // applicants, partners, and alumni who happen to still have a User row.
  // Pass the already-resolved termId to avoid a second currentTerm() call.
  const memberWhere = await currentTermMemberWhere(request);

  const [
    settings,
    userRow,
    whRows,
    links,
    groups,
    users,
    myProjects,
    myRoles,
    canSetSelfCheckIn,
    canMarkCoreMeeting,
  ] = await Promise.all([
      prisma.userAvailabilitySettings.findUnique({
        where: { userId },
        select: {
          timezone: true,
          defaultEventBufferMin: true,
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
      prisma.workingHoursDay.findMany({
        where: { userId },
        select: {
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          location: true,
          enabled: true,
        },
      }),
      prisma.userCalendarLink.findMany({
        where: { userId },
        orderBy: { linkedAt: "asc" },
      }),
      // Every active group is schedulable — the picker is intentionally not
      // limited to groups the organizer belongs to, so staff/Core can schedule
      // a meeting with any team (and the project hub's "Schedule meeting" button
      // pre-fills a project's group even for non-members). Group rosters aren't
      // sensitive here — they're already shown on hubs, the directory, etc.
      listAllGroups().then((rows) =>
        rows
          .filter((r) => !r.archived)
          .map((r) => ({
            id: r.id,
            name: r.name,
            memberIds: r.memberIds,
            projectId: r.dynamicQuery?.startsWith("project:")
              ? r.dynamicQuery.slice("project:".length)
              : null,
            systemKey: r.systemKey ?? null,
          })),
      ),
      prisma.user.findMany({
        where: memberWhere,
        select: { id: true, firstName: true, lastName: true, daliEmail: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.project.findMany({
        where: { assignments: { some: { userId } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      getUserRoleInstances(userId, termId, request),
      // Same gate as Forms: Core, Admin, or Instructor.
      canViewForms(userId, request),
      isCore(userId, request),
    ]);

  // Working hours are interpreted in the availability-settings zone when set;
  // otherwise fall back to the viewer's own display zone, not a hardcoded ET.
  const timezone = settings?.timezone ?? resolveUserTimeZone(userRow);
  const bufferMin = settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN;

  // Group persisted rows by day-of-week (multiple segments allowed per day).
  // Skip rows with enabled=false or invalid bounds; the UI treats them as deleted.
  const byDow = new Map<number, WhSegment[]>();
  for (const r of whRows) {
    if (!r.enabled || r.startMinute >= r.endMinute) continue;
    const list = byDow.get(r.dayOfWeek);
    const seg: WhSegment = {
      id: r.id,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      location: r.location,
    };
    if (list) list.push(seg);
    else byDow.set(r.dayOfWeek, [seg]);
  }
  // Defaults only apply for users who have never persisted working hours. Once
  // a user has any WorkingHoursDay row (even disabled / mid-edit), we trust the
  // persisted state — so an explicit "disable Monday" sticks instead of being
  // overwritten by the Mon–Fri 9–5 default on every reload.
  const hasAnyPersisted = whRows.length > 0;
  const workingHours: WhDay[] = defaultWorkingHours().map((d) => {
    const persisted = byDow.get(d.dayOfWeek);
    if (persisted && persisted.length > 0) {
      persisted.sort((a, b) => a.startMinute - b.startMinute);
      return { dayOfWeek: d.dayOfWeek, segments: persisted };
    }
    if (hasAnyPersisted) return { dayOfWeek: d.dayOfWeek, segments: [] };
    return d;
  });

  // Optional ?weekStart=YYYY-MM-DD URL param lets the user navigate weeks.
  // We use it as an anchor inside weekWindow(), which still snaps to that
  // date's Sunday — so any in-week date works. The anchor is built at noon
  // UTC of the requested calendar date so getZonedYMD resolves to the intended
  // local Y/M/D in any of the timezones we support (i.e. not split across
  // midnight on either side).
  const url = new URL(request.url);
  // `?anchor=` is the unified screen's date param; `?weekStart=` is the legacy
  // week-nav param (still honored). Either anchors the visible range.
  const anchorParam = url.searchParams.get("anchor") ?? url.searchParams.get("weekStart");
  let anchor: Date | undefined;
  if (anchorParam) {
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorParam);
    if (ymdMatch) {
      const y = Number(ymdMatch[1]);
      const m = Number(ymdMatch[2]);
      const d = Number(ymdMatch[3]);
      anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    } else {
      const parsed = new Date(anchorParam);
      if (!isNaN(parsed.getTime())) anchor = parsed;
    }
  }
  const view = parseView(url.searchParams.get("view"));
  // The containing week (back-compat: weekStartIso + the timesheet lower bound).
  const { start: weekStart, end: weekEnd } = weekWindow(timezone, anchor);
  // The range the unified screen actually shows — equal to the week window in
  // week view, wider in month view, one day in day view. Drives the event +
  // meeting fetch so month view has a month of data.
  const { start: rangeStart, end: rangeEnd } = viewWindow(timezone, view, anchor);

  // Rolling lower bound for time entries: keep ~8 weeks back from the visible
  // week so the timesheet prefill form has ample recent entries to copy from,
  // even when the user navigates a few weeks into the past or future.
  const timeEntryLowerBound = new Date(weekStart.getTime() - 8 * 7 * 86_400_000);

  // blocks and timeEntryRows are fetched here (not in the earlier Promise.all)
  // because they need weekStart for date-window filtering.
  const [blocks, timeEntryRows] = await Promise.all([
    prisma.manualBlock.findMany({
      where: {
        userId,
        // Keep ALL recurring blocks (they expand across any week) and only
        // filter one-off non-recurring blocks to those that end on/after the
        // visible week start.
        OR: [
          { recurrenceRule: { not: null } },
          { recurrenceRule: null, endTime: { gte: weekStart } },
        ],
      },
      orderBy: { startTime: "asc" },
      take: 200,
    }),
    prisma.timeEntry.findMany({
      where: {
        userId,
        date: { gte: timeEntryLowerBound },
      },
      orderBy: { date: "desc" },
      take: 200,
      select: {
        id: true,
        source: true,
        scheduledMeetingId: true,
        manualBlockId: true,
        assignmentType: true,
        roleRefId: true,
        projectId: true,
        date: true,
        hours: true,
        note: true,
        startTime: true,
        endTime: true,
        meeting: { select: { notePage: { select: { id: true } } } },
      },
    }),
  ]);

  // Fetch external busy + sub-calendar lists in parallel. Don't fail the page
  // if a single link errors — surface the error on the link card.
  //
  // Dedup: each Google link's calendar list (used for both color tinting in
  // fetchBusyEvents and for the SubCalendar UI) is fetched ONCE per link and
  // the result is threaded into both consumers, eliminating a second HTTP hit
  // per Google account.
  //
  // Step 1: fetch one valid token per Google link (one DB read each, with
  // optional refresh), then use each token to fetch the calendar list. Both
  // results are shared with fetchBusyEvents so the full request makes exactly
  // one token read and one calendarList HTTP call per linked Google account.
  const googleLinks = links.filter((l) => l.provider === "Google");
  const prefetchedTokens = new Map<string, string>();
  const calendarListResults = await Promise.all(
    googleLinks.map(async (l) => {
      try {
        const token = await getValidAccessTokenForLink(l.id);
        prefetchedTokens.set(l.id, token);
        const items = await listCalendarsForLink(l.id, token);
        return { linkId: l.id, items } as const;
      } catch {
        return { linkId: l.id, items: undefined } as const;
      }
    }),
  );
  // Map of linkId → list (undefined if fetch failed); passed to fetchBusyEvents
  // so it skips re-fetching the list inside fetchBusyForLink.
  const prefetchedCalendarLists = new Map(
    calendarListResults.map(({ linkId, items }) => [linkId, items]),
  );

  // Resolve roles + flags once, up front — the calendar-crud read (all events,
  // with edit identity) replaces the busy-only read when the flag is on.
  const roles = await getUserRoles(userId, request);
  const crudEnabled = await isFeatureEnabled("calendar-google-crud", userId, roles, request);

  let ingestionError: string | null = null;
  const [externalRaw, calendarLinks, inviteRows] = await Promise.all([
    (crudEnabled
      ? fetchCalendarEvents(userId, rangeStart, rangeEnd, prefetchedCalendarLists, prefetchedTokens)
      : fetchBusyEvents(userId, rangeStart, rangeEnd, prefetchedCalendarLists, prefetchedTokens)
    ).catch((err): CalendarEvent[] | Awaited<ReturnType<typeof fetchBusyEvents>> => {
      ingestionError = err instanceof Error ? err.message : "Failed to fetch external events";
      return [];
    }),
    Promise.all(
      links.map(async (l): Promise<CalendarLinkDTO> => {
        const base = {
          id: l.id,
          provider: l.provider,
          externalEmail: l.externalEmail,
          displayName: l.displayName,
          enabled: l.enabled,
          primary: l.primary,
          syncError: l.syncError,
        };
        if (l.provider !== "Google") {
          return { ...base, subCalendars: null };
        }
        // Use the pre-fetched list rather than making another HTTP call.
        const items = prefetchedCalendarLists.get(l.id);
        if (!items) {
          return { ...base, subCalendars: null };
        }
        const enabledSet = new Set(l.subCalendarIds);
        // When subCalendarIds is empty, treat the primary as the only one in use.
        const subCalendars: SubCalendarDTO[] = items.map((it) => ({
          id: it.id,
          summary: it.summary,
          primary: it.primary === true,
          color: it.backgroundColor ?? null,
          enabled:
            l.subCalendarIds.length === 0 ? it.primary === true : enabledSet.has(it.id),
          writable: it.accessRole === "owner" || it.accessRole === "writer",
        }));
        return { ...base, subCalendars };
      }),
    ),
    // Meetings the viewer was invited to whose selected time lands in this
    // week — the MeetingInvite notification carries both the per-user RSVP and
    // the id the RSVP endpoint expects. Cancelled meetings are hidden, matching
    // the tasks/banner surfaces.
    prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        kind: "MeetingInvite",
        scheduledMeetingId: { not: null },
        scheduledMeeting: {
          status: { not: "Cancelled" },
          selectedAt: { gte: rangeStart, lt: rangeEnd },
        },
      },
      select: {
        id: true,
        rsvp: true,
        scheduledMeeting: {
          select: {
            id: true,
            title: true,
            selectedAt: true,
            durationMinutes: true,
            organizerId: true,
            participantUserIds: true,
            isCoreMeeting: true,
            notePage: { select: { id: true } },
            // Every invitee's RSVP lives on their own MeetingInvite row, so the
            // popover's guest list reads them all, not just the viewer's.
            notifications: {
              where: { kind: "MeetingInvite" },
              select: { recipientUserId: true, rsvp: true },
            },
          },
        },
      },
    }),
  ]);

  // Names for every organizer/participant on this week's invites, in one hit —
  // the picker's `users` list is current-term members only, so it can't be
  // relied on to resolve an organizer who has since gone alumni.
  const inviteeIds = new Set<string>();
  for (const n of inviteRows) {
    const m = n.scheduledMeeting;
    if (!m) continue;
    inviteeIds.add(m.organizerId);
    for (const id of m.participantUserIds) inviteeIds.add(id);
  }
  const inviteeRows =
    inviteeIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...inviteeIds] } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        })
      : [];
  const inviteeById = new Map(inviteeRows.map((u) => [u.id, u]));

  const meetingInvites: MeetingInviteDTO[] = inviteRows.flatMap((n) => {
    const m = n.scheduledMeeting;
    if (!m?.selectedAt) return [];
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);
    const rsvpByUser = new Map(
      m.notifications.map((row) => [row.recipientUserId, row.rsvp] as const),
    );
    // Organizer first, then participants — the organizer isn't always in
    // participantUserIds, so dedupe rather than assume.
    const rosterIds = [m.organizerId, ...m.participantUserIds.filter((id) => id !== m.organizerId)];
    return [
      {
        notificationId: n.id,
        meetingId: m.id,
        title: m.title,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        rsvp: n.rsvp,
        notePageId: m.notePage?.id ?? null,
        isCoreMeeting: m.isCoreMeeting,
        organizerName: userDisplayName(inviteeById.get(m.organizerId)),
        attendees: rosterIds.map((id) => {
          const u = inviteeById.get(id);
          return {
            name: userDisplayName(u) ?? "Unknown member",
            // The organizer scheduled it, so treat them as attending rather
            // than showing them permanently "Pending" on their own meeting.
            status: id === m.organizerId ? "Accepted" : rsvpByUser.get(id) || "Pending",
            organizer: id === m.organizerId,
          };
        }),
      },
    ];
  });

  // Derived from the calendar lists already fetched above — no extra Google
  // round-trip.
  const generalCalendar = generalCalendarState(calendarLinks);

  // Map the external read to display DTOs. The crud read carries edit identity
  // (eventId/linkId/writable/allDay); the busy read is title/time only.
  const externalEvents: ExternalEventDTO[] = crudEnabled
    ? (externalRaw as CalendarEvent[]).map((e) => ({
        startIso: e.startIso,
        endIso: e.endIso,
        title: e.title || "Busy",
        color: e.color ?? null,
        calendarId: e.calendarId,
        eventId: e.eventId,
        linkId: e.linkId,
        allDay: e.allDay,
        writable: e.writable,
        recurringEventId: e.recurringEventId ?? null,
        description: e.description,
        location: e.location,
        organizerName: e.organizerName,
        attendees: externalAttendees(e.attendees),
        links: externalLinks(e.meetingUrl, e.htmlLink),
      }))
    : (externalRaw as Awaited<ReturnType<typeof fetchBusyEvents>>).map((e) => ({
        startIso: e.start,
        endIso: e.end,
        title: e.title ?? "Busy",
        color: e.color ?? null,
        calendarId: e.calendarId ?? null,
        description: e.description,
        location: e.location,
        organizerName: e.organizerName,
        attendees: externalAttendees(e.attendees),
        links: externalLinks(e.meetingUrl, e.htmlLink),
      }));

  // Classes this term (flag-gated). Only touch the table when the flag is on.
  const classesEnabled = await isFeatureEnabled("calendar-classes", userId, roles, request);
  let memberClasses: MemberClassDTO[] = [];
  let classOccurrences: ClassOccurrenceDTO[] = [];
  let classDestinations: ClassDestinationDTO[] = [];
  if (classesEnabled && term) {
    const classRows = await prisma.memberClass.findMany({
      where: { userId, termId: term.id },
      orderBy: { createdAt: "asc" },
    });
    memberClasses = classRows.map((r) => toMemberClassDTO(r, calendarLinks));
    classDestinations = buildClassDestinations(calendarLinks);
    // Expand only Local classes across the fetched range; Google-stored classes
    // ride the external layer (they're real events on the linked calendar).
    for (const r of classRows) {
      if (r.storage !== "Local") continue;
      const occ = expandClassOccurrences(
        r.meetings as unknown as PeriodMeeting[],
        term.startDate,
        term.endDate,
        rangeStart,
        rangeEnd,
      );
      for (const o of occ) {
        classOccurrences.push({ classId: r.id, title: r.title, startIso: o.startIso, endIso: o.endIso, kind: o.kind });
      }
    }
  }

  const data: LoaderData = {
    timezone,
    defaultEventBufferMin: bufferMin,
    workingHours,
    hasPersistedWorkingHours: hasAnyPersisted,
    manualBlocks: blocks.map((b) => ({
      id: b.id,
      title: b.title,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      recurrenceRule: b.recurrenceRule,
      isWork: b.isWork,
      assignmentType: b.assignmentType,
      roleRefId: b.roleRefId,
      workNote: b.workNote,
    })),
    calendarLinks,
    generalCalendar,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    view,
    rangeStartIso: rangeStart.toISOString(),
    rangeEndIso: rangeEnd.toISOString(),
    externalEvents,
    ingestionError,
    groups,
    users,
    currentUserId: userId,
    myProjects,
    myRoles,
    canSetSelfCheckIn,
    canMarkCoreMeeting,
    timeEntries: timeEntryRows.map((t) => ({
      id: t.id,
      source: t.source,
      scheduledMeetingId: t.scheduledMeetingId,
      manualBlockId: t.manualBlockId,
      meetingNotePageId: t.meeting?.notePage?.id ?? null,
      assignmentType: t.assignmentType,
      roleRefId: t.roleRefId,
      projectId: t.projectId,
      date: t.date.toISOString(),
      hours: t.hours,
      note: t.note,
      startTime: t.startTime ? t.startTime.toISOString() : null,
      endTime: t.endTime ? t.endTime.toISOString() : null,
    })),
    meetingInvites,
    classesEnabled,
    classTerm: term ? { id: term.id, code: term.code } : null,
    memberClasses,
    classOccurrences,
    classDestinations,
    crudEnabled,
    defaultEventDest: readCookie(request, "dali_event_dest"),
    defaultEventDurationMin: parseDurationCookie(readCookie(request, "dali_event_duration")),
  };
  return data;
}

export async function submitCalendarAction(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.type === "applicant")
    return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());

  // Classes-this-term intents carry their own shape (period/custom + Google
  // destination), so they're handled before the Zod-validated calendar action.
  const rawIntent = typeof raw.intent === "string" ? raw.intent : "";
  if (rawIntent.startsWith("class-")) {
    return handleClassAction(rawIntent, raw, userId, request);
  }
  if (rawIntent.startsWith("event-")) {
    return handleEventAction(rawIntent, raw, userId, request);
  }
  if (rawIntent.startsWith("cal-")) {
    return handleCalendarAction(rawIntent, raw, userId, request);
  }

  // Coerce string-encoded fields into the shape Zod expects.
  const candidate = coerceFormToAction(raw);
  const parsed = CalendarActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  switch (input.intent) {
    case "set-working-segments": {
      // Validate each segment's bounds and clamp.
      for (const s of input.segments) {
        if (s.startMinute >= s.endMinute) {
          return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.workingHoursDay.deleteMany({
          where: { userId, dayOfWeek: input.dayOfWeek },
        });
        if (input.segments.length > 0) {
          await tx.workingHoursDay.createMany({
            data: input.segments.map((s) => ({
              userId,
              dayOfWeek: input.dayOfWeek,
              enabled: true,
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          });
        } else {
          // Sentinel row that records "user explicitly cleared this day."
          // The loader skips disabled rows for availability calc but uses their
          // existence to distinguish "explicit empty" from "never set."
          await tx.workingHoursDay.create({
            data: {
              userId,
              dayOfWeek: input.dayOfWeek,
              enabled: false,
              startMinute: 0,
              endMinute: 1,
              location: "InPerson",
            },
          });
        }
      });
      return null;
    }

    case "copy-weekdays": {
      // Copy all of Monday's segments to Tue–Fri.
      const mondaySegments = await prisma.workingHoursDay.findMany({
        where: { userId, dayOfWeek: 1, enabled: true },
        select: { startMinute: true, endMinute: true, location: true, enabled: true },
      });
      if (mondaySegments.length === 0) return null;
      const tuesToFri = [2, 3, 4, 5];
      await prisma.$transaction(async (tx) => {
        await tx.workingHoursDay.deleteMany({
          where: { userId, dayOfWeek: { in: tuesToFri } },
        });
        await tx.workingHoursDay.createMany({
          data: tuesToFri.flatMap((dow) =>
            mondaySegments.map((s) => ({
              userId,
              dayOfWeek: dow,
              enabled: s.enabled,
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          ),
        });
      });
      return null;
    }

    case "reset-working-hours": {
      await prisma.workingHoursDay.deleteMany({ where: { userId } });
      return null;
    }

    case "seed-working-hours": {
      // Materialize the supplied full-week segment set in one transaction. Used
      // when the user first turns Working Hours on (or edits a day) while the
      // state is still the in-memory default: persisting only the edited day
      // would leave the other days with no rows, and the loader's
      // "hasAnyPersisted ⇒ unlisted day is empty" rule would then silently wipe
      // the default Mon–Fri hours. Seeding all days at once keeps them.
      for (const d of input.days) {
        for (const s of d.segments) {
          if (s.startMinute >= s.endMinute) {
            return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
          }
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.workingHoursDay.deleteMany({ where: { userId } });
        const rows = input.days.flatMap((d) =>
          d.segments.length > 0
            ? d.segments.map((s) => ({
                userId,
                dayOfWeek: d.dayOfWeek,
                enabled: true,
                startMinute: s.startMinute,
                endMinute: s.endMinute,
                location: s.location,
              }))
            : [
                // Sentinel "explicitly empty" row, same as set-working-segments.
                {
                  userId,
                  dayOfWeek: d.dayOfWeek,
                  enabled: false,
                  startMinute: 0,
                  endMinute: 1,
                  location: "InPerson" as const,
                },
              ],
        );
        if (rows.length > 0) await tx.workingHoursDay.createMany({ data: rows });
      });
      return null;
    }

    case "set-event-buffer": {
      await prisma.userAvailabilitySettings.upsert({
        where: { userId },
        create: { userId, defaultEventBufferMin: input.defaultEventBufferMin },
        update: { defaultEventBufferMin: input.defaultEventBufferMin },
      });
      return null;
    }

    case "add-manual-block": {
      const startTime = new Date(input.startTime);
      const endTime = new Date(input.endTime);
      if (endTime <= startTime) {
        return Response.json({ error: "endTime must be after startTime" }, { status: 400 });
      }
      const recurrenceRule = input.recurrenceRule ?? null;
      if (input.isWork && recurrenceRule) {
        return Response.json(
          { error: "Recurring blocks can't be marked as work yet" },
          { status: 400 },
        );
      }
      const block = await prisma.manualBlock.create({
        data: {
          userId,
          title: input.title,
          startTime,
          endTime,
          allDay: input.allDay,
          recurrenceRule,
          isWork: input.isWork,
          assignmentType: input.assignmentType ?? null,
          roleRefId: input.roleRefId ?? null,
        },
      });
      const sync = await syncManualBlockTimeEntry({
        manualBlockId: block.id,
        userId,
        isWork: input.isWork,
        assignmentType: input.assignmentType ?? null,
        roleRefId: input.roleRefId ?? null,
        title: input.title,
        startTime,
        endTime,
      });
      if (!sync.ok) return Response.json({ error: sync.error }, { status: 400 });
      return null;
    }

    case "update-manual-block": {
      const existing = await prisma.manualBlock.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const startTime = input.startTime ? new Date(input.startTime) : existing.startTime;
      const endTime = input.endTime ? new Date(input.endTime) : existing.endTime;
      if (endTime <= startTime) {
        return Response.json({ error: "endTime must be after startTime" }, { status: 400 });
      }
      const title = input.title ?? existing.title;
      const recurrenceRule =
        input.recurrenceRule === undefined ? existing.recurrenceRule : input.recurrenceRule;
      const isWork = input.isWork ?? existing.isWork;
      const assignmentType =
        input.assignmentType === undefined ? existing.assignmentType : input.assignmentType;
      const roleRefId = input.roleRefId === undefined ? existing.roleRefId : input.roleRefId;
      if (isWork && recurrenceRule) {
        return Response.json(
          { error: "Recurring blocks can't be marked as work yet" },
          { status: 400 },
        );
      }
      await prisma.manualBlock.update({
        where: { id: input.id },
        data: {
          title,
          startTime,
          endTime,
          allDay: input.allDay ?? existing.allDay,
          recurrenceRule,
          isWork,
          assignmentType,
          roleRefId,
        },
      });
      const sync = await syncManualBlockTimeEntry({
        manualBlockId: input.id,
        userId,
        isWork,
        assignmentType,
        roleRefId,
        title,
        startTime,
        endTime,
      });
      if (!sync.ok) return Response.json({ error: sync.error }, { status: 400 });
      return null;
    }

    case "remove-manual-block": {
      const existing = await prisma.manualBlock.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      await prisma.$transaction([
        prisma.timeEntry.deleteMany({ where: { manualBlockId: input.id, userId } }),
        prisma.manualBlock.delete({ where: { id: input.id } }),
      ]);
      return null;
    }

    case "remove-calendar-link": {
      const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
      if (!link || link.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
      return null;
    }

    case "toggle-sub-calendar": {
      const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
      if (!link || link.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const current = new Set(link.subCalendarIds);
      if (input.enabled) current.add(input.calendarId);
      else current.delete(input.calendarId);
      await prisma.userCalendarLink.update({
        where: { id: input.linkId },
        data: { subCalendarIds: Array.from(current) },
      });
      return null;
    }

    case "subscribe-general-calendar": {
      const generalId = generalCalendarId();
      if (!generalId) {
        return Response.json({ error: "No DALI calendar is configured" }, { status: 400 });
      }
      const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
      if (!link || link.userId !== userId || link.provider !== "Google") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      try {
        await subscribeCalendarForLink(link.id, generalId);
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Couldn't add the DALI calendar" },
          { status: 502 },
        );
      }
      return null;
    }

    case "add-time-entry": {
      const rangeError = validateTimeEntryRange(input);
      if (rangeError) return Response.json({ error: rangeError }, { status: 400 });
      const resolved = await resolveRoleRef(userId, input.assignmentType, input.roleRefId);
      if (!resolved) return Response.json({ error: "Invalid role" }, { status: 400 });
      const projectId = resolved.projectId;
      await prisma.timeEntry.create({
        data: {
          userId,
          source: "Manual",
          date: new Date(input.date),
          hours: input.hours,
          assignmentType: input.assignmentType,
          roleRefId: input.roleRefId,
          projectId,
          note: input.note ?? null,
          startTime: new Date(input.startTime),
          endTime: new Date(input.endTime),
        },
      });
      return null;
    }

    case "update-time-entry": {
      const existing = await prisma.timeEntry.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const assignmentType =
        input.assignmentType === undefined ? existing.assignmentType : input.assignmentType;
      const roleRefId = input.roleRefId === undefined ? existing.roleRefId : input.roleRefId;
      let projectId = existing.projectId;
      if (input.assignmentType !== undefined || input.roleRefId !== undefined) {
        // A patch that touches either half must land on a complete, real role
        // — this is the path that used to allow clearing back to unassigned.
        if (!assignmentType || !roleRefId) {
          return Response.json({ error: "A role is required" }, { status: 400 });
        }
        const resolved = await resolveRoleRef(userId, assignmentType, roleRefId);
        if (!resolved) return Response.json({ error: "Invalid role" }, { status: 400 });
        projectId = resolved.projectId;
      }

      const startTime =
        input.startTime === undefined ? existing.startTime : new Date(input.startTime);
      const endTime = input.endTime === undefined ? existing.endTime : new Date(input.endTime);
      const hours = input.hours ?? existing.hours;
      // Validate the MERGED result, not just the patch: a partial update that
      // moves only `end` earlier than the stored `start` is still invalid.
      const rangeError = validateTimeEntryRange({
        startTime: startTime ? startTime.toISOString() : null,
        endTime: endTime ? endTime.toISOString() : null,
        hours,
      });
      if (rangeError) return Response.json({ error: rangeError }, { status: 400 });

      const note = input.note === undefined ? existing.note : input.note;
      const date = input.date ? new Date(input.date) : existing.date;

      // Block-sourced rows mirror a ManualBlock on Availability — keep that
      // block's title/time/role in lockstep so the two views don't diverge.
      if (existing.source === "Block" && existing.manualBlockId) {
        if (!startTime || !endTime) {
          return Response.json({ error: "Block entries need a start and end time" }, { status: 400 });
        }
        if (!assignmentType || !roleRefId) {
          return Response.json({ error: "A role is required" }, { status: 400 });
        }
        await prisma.manualBlock.update({
          where: { id: existing.manualBlockId },
          data: {
            title: note?.trim() || "Work",
            startTime,
            endTime,
            isWork: true,
            assignmentType,
            roleRefId,
          },
        });
        const sync = await syncManualBlockTimeEntry({
          manualBlockId: existing.manualBlockId,
          userId,
          isWork: true,
          assignmentType,
          roleRefId,
          title: note?.trim() || "Work",
          startTime,
          endTime,
        });
        if (!sync.ok) return Response.json({ error: sync.error }, { status: 400 });
        return null;
      }

      await prisma.timeEntry.update({
        where: { id: input.id },
        data: {
          date,
          hours,
          assignmentType,
          roleRefId,
          projectId,
          note,
          startTime,
          endTime,
        },
      });
      return null;
    }

    case "delete-time-entry": {
      const existing = await prisma.timeEntry.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      // Block rows own a ManualBlock — remove both so Availability doesn't keep
      // a work block that no longer has hours on the timesheet.
      if (existing.source === "Block" && existing.manualBlockId) {
        await prisma.$transaction([
          prisma.timeEntry.deleteMany({
            where: { manualBlockId: existing.manualBlockId, userId },
          }),
          prisma.manualBlock.delete({ where: { id: existing.manualBlockId } }),
        ]);
        return null;
      }
      await prisma.timeEntry.delete({ where: { id: input.id } });
      return null;
    }

    case "toggle-meeting-time-entry": {
      // Only a participant (or the organizer) may log the meeting, and only on
      // their own timesheet — userId comes from the session, never the form.
      const meeting = await prisma.scheduledMeeting.findUnique({
        where: { id: input.meetingId },
        select: {
          id: true,
          status: true,
          projectId: true,
          durationMinutes: true,
          selectedAt: true,
          createdAt: true,
          organizerId: true,
          participantUserIds: true,
        },
      });
      if (!meeting || meeting.status === "Cancelled") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      if (meeting.organizerId !== userId && !meeting.participantUserIds.includes(userId)) {
        return Response.json({ error: "You weren't invited to this meeting" }, { status: 403 });
      }
      if (!input.onTimesheet) {
        await prisma.timeEntry.deleteMany({ where: { scheduledMeetingId: meeting.id, userId } });
        return null;
      }
      if (!meeting.selectedAt) {
        return Response.json(
          { error: "This meeting doesn't have a scheduled time yet" },
          { status: 400 },
        );
      }
      const startTime = meeting.selectedAt;
      const endTime = new Date(startTime.getTime() + meeting.durationMinutes * 60_000);
      const hours = meeting.durationMinutes / 60;
      // Same shape attendance produces (`markMeetingAttendance`), minus the
      // MeetingAttendance flip — logging your own hours isn't a claim that the
      // organizer marked you present. The role is left unset: the Timesheet
      // edit popover is where it gets attributed, as with attendance rows.
      await prisma.timeEntry.upsert({
        where: { scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId } },
        create: {
          userId,
          source: "Meeting",
          scheduledMeetingId: meeting.id,
          projectId: meeting.projectId,
          date: startTime,
          hours,
          startTime,
          endTime,
        },
        update: { projectId: meeting.projectId, date: startTime, hours, startTime, endTime },
      });
      return null;
    }

    case "set-meeting-core": {
      // The checkbox is hidden for non-Core, but the gate lives here — the
      // form is a hint, the server decides (same rule as the create route).
      if (!(await isCore(userId, request))) return forbidden(request);
      const meeting = await prisma.scheduledMeeting.findUnique({
        where: { id: input.meetingId },
        select: { id: true, organizerId: true, participantUserIds: true },
      });
      if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
      if (meeting.organizerId !== userId && !meeting.participantUserIds.includes(userId)) {
        return Response.json({ error: "You weren't invited to this meeting" }, { status: 403 });
      }
      await prisma.scheduledMeeting.update({
        where: { id: meeting.id },
        data: { isCoreMeeting: input.isCoreMeeting },
      });
      return null;
    }
  }
}
