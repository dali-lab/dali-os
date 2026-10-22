import type { ExternalEventDTO, RsvpStatus, TimeEntryDTO } from "~/calendar/lib/types";

export const RSVP_STATUS_FROM_RESPONSE: Record<string, RsvpStatus> = {
  accepted: "Accepted",
  tentative: "Tentative",
  declined: "Declined",
};

/** Intents whose in-flight form data the grid draws before the server answers. */
export const OPTIMISTIC_INTENTS = new Set([
  "event-move",
  "event-update",
  "event-delete",
  "event-rsvp",
  "event-create",
  "add-time-entry",
  "update-time-entry",
  "delete-time-entry",
]);

/**
 * One write that has been sent (or is being sent) and not yet confirmed by a
 * fresh loader read. `meeting-create` and `meeting-update` are the same idea
 * for the two meeting writes that go through plain `fetch()` rather than a
 * router fetcher.
 */
export type PendingSubmission = { id: string; fields: Record<string, string> };

type FetcherLike = {
  key: string;
  state: string;
  formData?: FormData;
  data?: unknown;
};

const submissionOrder = new WeakMap<FormData, number>();
let nextOrder = 0;

function orderOf(formData: FormData): number {
  let n = submissionOrder.get(formData);
  if (n === undefined) {
    n = ++nextOrder;
    submissionOrder.set(formData, n);
  }
  return n;
}

function fieldsOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * The submissions to draw, oldest first so a later one on the same event wins.
 * A fetcher keeps its formData until the revalidation after its action lands,
 * and loses it the moment it goes idle, so the patch disappears exactly when
 * fresh data replaces it. One whose action answered with an error draws
 * nothing: the block snaps back while the error is reported.
 */
export function pendingFromFetchers(fetchers: FetcherLike[]): PendingSubmission[] {
  return fetchers
    .filter((f) => {
      if (f.state === "idle" || !f.formData) return false;
      if (!OPTIMISTIC_INTENTS.has(String(f.formData.get("intent")))) return false;
      return !(f.data as { error?: unknown } | null | undefined)?.error;
    })
    .map((f) => ({ order: orderOf(f.formData!), id: f.key, fields: fieldsOf(f.formData!) }))
    .sort((a, b) => a.order - b.order)
    .map(({ id, fields }) => ({ id, fields }));
}

type Patchable = { externalEvents: ExternalEventDTO[]; timeEntries: TimeEntryDTO[] };

export type PendingOptions = {
  /** Calendar colour by `<linkId>:<calendarId>`, for a ghost's fill. */
  destinationColors?: Record<string, string | null>;
};

export const pendingEventId = (id: string) => `pending:${id}`;

function deleteMatcher(f: Record<string, string>, events: ExternalEventDTO[]) {
  const recurringId = f.recurringEventId || null;
  const scope = f.scope || "this";
  if (!recurringId || scope === "this") return (e: ExternalEventDTO) => e.eventId === f.eventId;
  if (scope === "all") {
    return (e: ExternalEventDTO) => e.recurringEventId === recurringId || e.eventId === recurringId;
  }
  const fromIso = f.originalStartIso || events.find((e) => e.eventId === f.eventId)?.startIso;
  const from = fromIso ? Date.parse(fromIso) : NaN;
  if (Number.isNaN(from)) return (e: ExternalEventDTO) => e.eventId === f.eventId;
  return (e: ExternalEventDTO) =>
    e.eventId === f.eventId || (e.recurringEventId === recurringId && Date.parse(e.startIso) >= from);
}

function patchEvents(
  events: ExternalEventDTO[],
  match: (e: ExternalEventDTO) => boolean,
  patch: (e: ExternalEventDTO) => Partial<ExternalEventDTO>,
) {
  return events.map((e) => (match(e) ? { ...e, ...patch(e) } : e));
}

function ghostEvent(
  sub: PendingSubmission,
  opts: PendingOptions,
): ExternalEventDTO | null {
  const f = sub.fields;
  if (f.allDay === "1" || !f.startIso || !f.endIso) return null;
  return {
    startIso: f.startIso,
    endIso: f.endIso,
    title: f.title || "(No title)",
    color: opts.destinationColors?.[f.destination ?? ""] ?? null,
    calendarId: f.destination?.split(":")[1] || null,
    eventId: pendingEventId(sub.id),
    writable: false,
    pending: true,
  };
}

function ghostEntry(sub: PendingSubmission): TimeEntryDTO | null {
  const f = sub.fields;
  if (f.scheduledMeetingId || !f.startTime || !f.endTime) return null;
  return {
    id: pendingEventId(sub.id),
    source: "Manual",
    scheduledMeetingId: null,
    occurrenceStart: null,
    sourceEventId: null,
    manualBlockId: null,
    meetingNotePageId: null,
    assignmentType: (f.assignmentType || null) as TimeEntryDTO["assignmentType"],
    roleRefId: f.roleRefId || null,
    projectId: null,
    date: new Date(f.date || f.startTime).toISOString(),
    hours: Number(f.hours) || 0,
    note: f.note || null,
    startTime: f.startTime,
    endTime: f.endTime,
  };
}

function patchEntry(entry: TimeEntryDTO, f: Record<string, string>): TimeEntryDTO {
  return {
    ...entry,
    ...(f.startTime ? { startTime: f.startTime } : {}),
    ...(f.endTime ? { endTime: f.endTime } : {}),
    ...(f.date ? { date: new Date(f.date).toISOString() } : {}),
    ...(f.hours ? { hours: Number(f.hours) } : {}),
    ...(f.note !== undefined ? { note: f.note || null } : {}),
    ...(f.assignmentType && f.roleRefId
      ? {
          assignmentType: f.assignmentType as TimeEntryDTO["assignmentType"],
          roleRefId: f.roleRefId,
        }
      : {}),
  };
}

/**
 * The loader's events and time entries with every pending write applied, in
 * order. Pure: the same inputs always give the same lists, and with nothing
 * pending the input comes back untouched.
 */
export function applyPending<T extends Patchable>(
  data: T,
  pending: PendingSubmission[],
  opts: PendingOptions = {},
): T {
  if (pending.length === 0) return data;
  let events = data.externalEvents;
  let entries = data.timeEntries;

  for (const sub of pending) {
    const f = sub.fields;
    switch (f.intent) {
      case "event-move":
        if (f.startIso && f.endIso) {
          events = patchEvents(events, (e) => e.eventId === f.eventId, () => ({
            startIso: f.startIso!,
            endIso: f.endIso!,
          }));
        }
        break;
      case "event-update":
        events = patchEvents(events, (e) => e.eventId === f.eventId, (e) => ({
          ...(f.title ? { title: f.title } : {}),
          // An all-day event's bounds are dates, not instants; only a timed
          // edit of a timed event is a time change the grid can draw.
          ...(f.startIso && f.endIso && f.allDay !== "1" && !e.allDay
            ? { startIso: f.startIso, endIso: f.endIso }
            : {}),
        }));
        break;
      case "meeting-update": {
        const shift = Number(f.shiftMs) || 0;
        const durationMs = (Number(f.durationMinutes) || 0) * 60_000;
        events = patchEvents(events, (e) => e.meeting?.meetingId === f.meetingId, (e) => {
          const start = Date.parse(e.startIso) + shift;
          return {
            ...(f.title ? { title: f.title } : {}),
            ...(durationMs > 0
              ? {
                  startIso: new Date(start).toISOString(),
                  endIso: new Date(start + durationMs).toISOString(),
                }
              : {}),
          };
        });
        break;
      }
      case "event-rsvp": {
        const status = RSVP_STATUS_FROM_RESPONSE[f.response ?? ""];
        if (status) events = patchEvents(events, (e) => e.eventId === f.eventId, () => ({ rsvp: status }));
        break;
      }
      case "event-delete": {
        const match = deleteMatcher(f, events);
        // Stopping tracking leaves the Google event; only the meeting goes.
        const hides = (e: ExternalEventDTO) => match(e) && e.meeting?.googleEventOrigin !== "Tracked";
        const hidden = new Set(events.filter(hides).map((e) => e.eventId));
        events = events.filter((e) => !hides(e));
        // The hours were the event's hours; the server drops them with it.
        entries = entries.filter((t) => !t.sourceEventId || !hidden.has(t.sourceEventId));
        break;
      }
      case "event-create":
      case "meeting-create": {
        const ghost = ghostEvent(sub, opts);
        if (ghost) events = [...events, ghost];
        break;
      }
      case "add-time-entry": {
        const ghost = ghostEntry(sub);
        if (ghost) entries = [...entries, ghost];
        break;
      }
      case "update-time-entry":
        entries = entries.map((t) => (t.id === f.id ? patchEntry(t, f) : t));
        break;
      case "delete-time-entry":
        entries = entries.filter((t) => t.id !== f.id);
        break;
    }
  }

  return { ...data, externalEvents: events, timeEntries: entries };
}
