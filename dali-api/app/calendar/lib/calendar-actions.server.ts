import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { forbidden, requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { CalendarActionSchema, type CalendarAction } from "~/calendar/lib/calendar-schemas";
import { handleCalendarAction } from "~/calendar/lib/calendar-actions/calendars.server";
import { handleClassAction } from "~/calendar/lib/calendar-actions/classes.server";
import { handleEventAction } from "~/calendar/lib/calendar-actions/events.server";
import {
  handleAddMeetingNote,
  handleAddMeetingWhiteboard,
  handleAddTimeEntry,
  handleDeleteTimeEntry,
  handleSetMeetingProject,
  handleToggleMeetingTimeEntry,
  handleTrackEventAsMeeting,
  handleUpdateTimeEntry,
} from "~/calendar/lib/calendar-actions/meeting-log.server";
import {
  handleCopyWeekdays,
  handleRemoveCalendarLink,
  handleResetWorkingHours,
  handleSeedWorkingHours,
  handleSetEventBuffer,
  handleSetTimesheetSync,
  handleSetWorkingSegments,
  handleSubscribeGeneralCalendar,
  handleToggleSubCalendar,
} from "~/calendar/lib/calendar-actions/settings.server";
import type { CalendarActionContext, CalendarIntentInput } from "~/calendar/lib/calendar-actions/shared.server";

// The intents that write lab records rather than the viewer's own calendar:
// meeting notes and their Drive pages, the logged-time
// link on a meeting, promoting a Google event into a DALI meeting, and
// subscribing to the lab's general calendar. The portal calendar posts here
// too, so these stay member-only — everything else (working hours, linked
// calendars, Google events, classes this term, one's own time entries) is the
// viewer's own data and is open to a non-member.
const MEMBER_ONLY_CALENDAR_INTENTS = new Set([
  "subscribe-general-calendar",
  "toggle-meeting-time-entry",
  "add-meeting-note",
  "track-event-as-meeting",
]);

// Intents that only ever write to Postgres — never to Google, and never to
// which calendars/links the loader reads. A DB-only write leaves the cached
// Google read valid, so the post-write revalidate can still hit the 30s cache
// instead of re-fetching from Google.
const DB_ONLY_CALENDAR_INTENTS = new Set([
  "add-meeting-note",
  "add-meeting-whiteboard",
  "set-meeting-project",
  "set-working-segments",
  "copy-weekdays",
  "reset-working-hours",
  "seed-working-hours",
  "set-event-buffer",
  "track-event-as-meeting",
  // The loader reads every calendar on a link ("all"), whatever is toggled.
  "toggle-sub-calendar",
  // Meeting-sourced entries are never mirrored to Google, so removing one
  // never calls Google (removeTimeEntryFromGoogle returns without a mirror id).
  "toggle-meeting-time-entry",
]);

/** Exported for tests — the cache itself has no externally observable state. */
export function shouldInvalidateExternalCache(intent: string): boolean {
  return !DB_ONLY_CALENDAR_INTENTS.has(intent);
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
          segments = null;
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
        scheduledMeetingId: get("scheduledMeetingId") || undefined,
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
      return {
        intent,
        meetingId: get("meetingId"),
        onTimesheet: asBool(get("onTimesheet")),
        occurrence: get("occurrence") || undefined,
      };
    case "set-meeting-project":
      return {
        intent,
        meetingId: get("meetingId"),
        projectId: get("projectId") || undefined,
        meetingType: get("meetingType") || undefined,
        meetingTypeLabel: get("meetingTypeLabel") || undefined,
      };
    case "add-meeting-note":
    case "add-meeting-whiteboard": {
      // meetingType is optional for the whiteboard intent (a meeting with a note
      // reuses its type), so an empty field coerces to undefined rather than a
      // failing enum value.
      let notebook: unknown = undefined;
      const notebookRaw = get("notebook");
      if (notebookRaw) {
        try {
          notebook = JSON.parse(notebookRaw);
        } catch {
          // Left undefined; the schema then asks for the type fields instead.
        }
      }
      return {
        intent,
        meetingId: get("meetingId"),
        occurrence: get("occurrence") || undefined,
        meetingType: get("meetingType") || undefined,
        meetingTypeLabel: get("meetingTypeLabel") || undefined,
        projectId: get("projectId") || undefined,
        notebook,
      };
    }
    case "set-timesheet-sync":
      return { intent, enabled: asBool(get("enabled")) };
    default:
      return raw;
  }
}

export type CalendarActionHandler = (ctx: CalendarActionContext) => Promise<Response | null>;

function parseCalendarAction(raw: Record<string, FormDataEntryValue>): CalendarAction | Response {
  const candidate = coerceFormToAction(raw);
  const parsed = CalendarActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  return parsed.data;
}

const validated =
  <K extends CalendarAction["intent"]>(
    handle: (input: CalendarIntentInput<K>, ctx: CalendarActionContext) => Promise<Response | null>,
  ): CalendarActionHandler =>
  async (ctx) => {
    const parsed = parseCalendarAction(ctx.raw);
    if (parsed instanceof Response) return parsed;
    return handle(parsed as CalendarIntentInput<K>, ctx);
  };

const classAction =
  (intent: string): CalendarActionHandler =>
  ({ raw, userId, request }) =>
    handleClassAction(intent, raw, userId, request);

const eventAction =
  (intent: string): CalendarActionHandler =>
  ({ raw, userId, request }) =>
    handleEventAction(intent, raw, userId, request);

const calendarAction =
  (intent: string): CalendarActionHandler =>
  ({ raw, userId, request }) =>
    handleCalendarAction(intent, raw, userId, request);

export const CALENDAR_ACTION_HANDLERS: Record<string, CalendarActionHandler> = {
  "class-add": classAction("class-add"),
  "class-update": classAction("class-update"),
  "class-remove": classAction("class-remove"),
  "class-refresh": classAction("class-refresh"),
  "event-create": eventAction("event-create"),
  "event-update": eventAction("event-update"),
  "event-delete": eventAction("event-delete"),
  "event-move": eventAction("event-move"),
  "event-rsvp": eventAction("event-rsvp"),
  "cal-create": calendarAction("cal-create"),
  "cal-rename": calendarAction("cal-rename"),
  "cal-delete": calendarAction("cal-delete"),
  "set-working-segments": validated(handleSetWorkingSegments),
  "copy-weekdays": validated(handleCopyWeekdays),
  "reset-working-hours": validated(handleResetWorkingHours),
  "seed-working-hours": validated(handleSeedWorkingHours),
  "set-event-buffer": validated(handleSetEventBuffer),
  "remove-calendar-link": validated(handleRemoveCalendarLink),
  "toggle-sub-calendar": validated(handleToggleSubCalendar),
  "subscribe-general-calendar": validated(handleSubscribeGeneralCalendar),
  "set-timesheet-sync": validated(handleSetTimesheetSync),
  "add-time-entry": validated(handleAddTimeEntry),
  "update-time-entry": validated(handleUpdateTimeEntry),
  "delete-time-entry": validated(handleDeleteTimeEntry),
  "toggle-meeting-time-entry": validated(handleToggleMeetingTimeEntry),
  "set-meeting-project": validated(handleSetMeetingProject),
  "add-meeting-note": validated(handleAddMeetingNote),
  "add-meeting-whiteboard": validated(handleAddMeetingWhiteboard),
  "track-event-as-meeting": validated(handleTrackEventAsMeeting),
};

export async function submitCalendarAction(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());

  // Classes-this-term intents carry their own shape (period/custom + Google
  // destination), so they're handled before the Zod-validated calendar action.
  const rawIntent = typeof raw.intent === "string" ? raw.intent : "";

  // Any write that can change what the next Google read returns must drop this
  // user's cached external reads rather than letting the TTL hide the change.
  // Stamped before the handler so a read racing it is not cached as fresh, and
  // again after: a read that started mid-write cached the pre-write answer.
  if (!shouldInvalidateExternalCache(rawIntent)) return dispatchCalendarAction(request, userId, raw, rawIntent);
  await markCalendarChanged(userId);
  try {
    return await dispatchCalendarAction(request, userId, raw, rawIntent);
  } finally {
    await markCalendarChanged(userId);
  }
}

async function dispatchCalendarAction(
  request: Request,
  userId: string,
  raw: Record<string, FormDataEntryValue>,
  rawIntent: string,
) {
  if (
    MEMBER_ONLY_CALENDAR_INTENTS.has(rawIntent) &&
    !(await isLabMember(userId, request))
  ) {
    return forbidden(request);
  }
  const handler = Object.hasOwn(CALENDAR_ACTION_HANDLERS, rawIntent) ? CALENDAR_ACTION_HANDLERS[rawIntent] : undefined;
  if (handler) return handler({ request, userId, raw });
  const parsed = parseCalendarAction(raw);
  if (parsed instanceof Response) return parsed;
  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
