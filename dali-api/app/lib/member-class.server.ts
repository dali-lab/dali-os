// Server orchestration for "Classes this term": turning a member's class into
// either real recurring Google Calendar events (storage="Google") or a stored
// row rendered as a DALI-only layer (storage="Local"), and tearing those down
// on edit/remove. The schedule math lives in the client-safe class-schedule.ts;
// this module owns the prisma writes and the Google CRUD.

import { prisma } from "~/lib/db";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getOrCreateNamedCalendar,
  listCalendarsForLink,
  subscribeCalendarForLink,
} from "~/lib/google-calendar";
import { classRRule, DARTMOUTH_TZ, firstOccurrenceRange, resolveClassMeetings } from "~/calendar/lib/class-schedule";
import { getPeriod, type PeriodMeeting } from "~/calendar/lib/dartmouth-periods";
import {
  parseDestination as parseDestinationValue,
  formatCourseLocation,
  type ClassDestination,
} from "~/calendar/lib/class-format";
import type { CalendarLinkDTO, ClassDestinationDTO, ClassMeetingDTO, MemberClassDTO } from "~/calendar/lib/types";

const DEDICATED_CALENDAR_NAME = "Classes";

export class MemberClassError extends Error {}

export type { ClassDestination };

/** Parse the add-form's destination value, throwing on anything unrecognized. */
export function parseDestination(raw: string): ClassDestination {
  const d = parseDestinationValue(raw);
  if (!d) throw new MemberClassError("Unrecognized class destination");
  return d;
}

type ClassWrite = {
  userId: string;
  termId: string;
  title: string;
  location: string | null;
  periodCode: string | null;
  includeXHour: boolean;
  /** Required when periodCode is null (a custom day/time class). */
  customMeetings?: PeriodMeeting[];
  destination: ClassDestination;
  // Provenance when autofilled from the Dartmouth timetable; all null for a
  // manually-entered class. Denormalized onto the row (no FK into the cache).
  offeringCrn?: string | null;
  subject?: string | null;
  courseNumber?: string | null;
  section?: string | null;
};

/** The section-reference columns, shared by create and update writes. */
function sectionRef(input: ClassWrite) {
  return {
    offeringCrn: input.offeringCrn ?? null,
    subject: input.subject ?? null,
    courseNumber: input.courseNumber ?? null,
    section: input.section ?? null,
  };
}

function meetingsFor(input: ClassWrite): PeriodMeeting[] {
  const meetings = input.periodCode
    ? resolveClassMeetings({ periodCode: input.periodCode, includeXHour: input.includeXHour })
    : resolveClassMeetings({ custom: input.customMeetings ?? [] });
  if (meetings.length === 0) throw new MemberClassError("This class has no meeting times.");
  return meetings;
}

async function resolvePrimaryCalendarId(linkId: string): Promise<string> {
  try {
    const list = await listCalendarsForLink(linkId);
    return list.find((c) => c.primary)?.id ?? "primary";
  } catch {
    return "primary";
  }
}

// A class written to Google only appears in DALI if its calendar is in the
// link's subCalendarIds (fetchBusyEvents pulls only those; an empty set means
// primary-only). So make the target calendar visible: subscribe it, then add it
// to subCalendarIds — seeding the real primary first when the set was empty, so
// making it explicit doesn't hide the calendar the member already sees.
async function ensureCalendarVisible(linkId: string, calendarId: string): Promise<void> {
  try {
    await subscribeCalendarForLink(linkId, calendarId);
  } catch {
    /* already subscribed / owned — subscribe is best-effort */
  }
  const link = await prisma.userCalendarLink.findUnique({
    where: { id: linkId },
    select: { subCalendarIds: true },
  });
  if (!link) return;
  const set = new Set(link.subCalendarIds);
  if (set.has(calendarId)) return;
  if (set.size === 0) set.add(await resolvePrimaryCalendarId(linkId));
  set.add(calendarId);
  await prisma.userCalendarLink.update({
    where: { id: linkId },
    data: { subCalendarIds: Array.from(set) },
  });
}

async function loadTerm(termId: string) {
  const term = await prisma.term.findUnique({ where: { id: termId }, select: { startDate: true, endDate: true } });
  if (!term) throw new MemberClassError("Term not found");
  return term;
}

// Write the class to its destination and return the storage columns. For Google
// this creates one recurring event per meeting (main, and x-hour when included).
async function materialize(
  input: ClassWrite,
  meetings: PeriodMeeting[],
  term: { startDate: Date; endDate: Date },
): Promise<{ storage: string; linkId: string | null; calendarId: string | null; googleEventIds: string[] }> {
  const dest = input.destination;
  if (dest.kind === "local") {
    return { storage: "Local", linkId: null, calendarId: null, googleEventIds: [] };
  }

  // Only the member's own Google links are writable.
  const link = await prisma.userCalendarLink.findFirst({
    where: { id: dest.linkId, userId: input.userId, provider: "Google" },
    select: { id: true },
  });
  if (!link) throw new MemberClassError("That calendar isn't connected to your account.");

  const calendarId =
    dest.kind === "google-dedicated"
      ? await getOrCreateNamedCalendar(dest.linkId, DEDICATED_CALENDAR_NAME)
      : dest.kind === "google-primary"
        ? await resolvePrimaryCalendarId(dest.linkId)
        : dest.calendarId;

  // Make the class visible in DALI too: pull this calendar into the layer set.
  await ensureCalendarVisible(dest.linkId, calendarId);

  const googleEventIds: string[] = [];
  for (const m of meetings) {
    const { startIso, endIso } = firstOccurrenceRange(m, term.startDate);
    const { eventId } = await createGoogleCalendarEvent({
      linkId: dest.linkId,
      calendarId,
      summary: m.kind === "xhour" ? `${input.title} (x-hour)` : input.title,
      location: input.location ?? undefined,
      startIso,
      endIso,
      recurrenceRule: classRRule(m, term.endDate),
      timeZone: DARTMOUTH_TZ,
      attendees: [],
    });
    googleEventIds.push(eventId);
  }
  return { storage: "Google", linkId: dest.linkId, calendarId, googleEventIds };
}

async function tearDownGoogle(row: { storage: string; linkId: string | null; calendarId: string | null; googleEventIds: string[] }) {
  if (row.storage !== "Google" || !row.linkId) return;
  for (const eventId of row.googleEventIds) {
    // Best-effort: a failed delete leaves an orphan event but must not block the
    // member from removing/editing the class.
    try {
      await deleteGoogleCalendarEvent({ linkId: row.linkId, calendarId: row.calendarId ?? undefined, eventId });
    } catch {
      /* swallow — orphaned Google event is preferable to a stuck row */
    }
  }
}

export async function createClass(input: ClassWrite): Promise<void> {
  const meetings = meetingsFor(input);
  const term = await loadTerm(input.termId);
  const mat = await materialize(input, meetings, term);
  await prisma.memberClass.create({
    data: {
      userId: input.userId,
      termId: input.termId,
      title: input.title,
      periodCode: input.periodCode,
      meetings: meetings as unknown as object,
      location: input.location,
      ...sectionRef(input),
      ...mat,
    },
  });
}

export async function updateClass(classId: string, input: ClassWrite): Promise<void> {
  const row = await prisma.memberClass.findFirst({ where: { id: classId, userId: input.userId } });
  if (!row) throw new MemberClassError("Class not found");
  const meetings = meetingsFor(input);
  const term = await loadTerm(input.termId);
  // Full replace: tear the old Google events down, then re-create at the new
  // destination/schedule. Simpler and always-correct vs. patching an RRULE.
  await tearDownGoogle(row);
  const mat = await materialize(input, meetings, term);
  await prisma.memberClass.update({
    where: { id: classId },
    data: {
      title: input.title,
      periodCode: input.periodCode,
      meetings: meetings as unknown as object,
      location: input.location,
      ...sectionRef(input),
      ...mat,
    },
  });
}

export async function removeClass(userId: string, classId: string): Promise<void> {
  const row = await prisma.memberClass.findFirst({ where: { id: classId, userId } });
  if (!row) throw new MemberClassError("Class not found");
  await tearDownGoogle(row);
  await prisma.memberClass.delete({ where: { id: classId } });
}

// Re-pull a timetable-sourced class's current period + location from the synced
// CourseOffering cache and re-apply them (title/destination kept). Backs the
// per-class "refresh" button and the one-click "apply" on a change alert.
export async function refreshClass(userId: string, classId: string): Promise<void> {
  const row = await prisma.memberClass.findFirst({ where: { id: classId, userId } });
  if (!row) throw new MemberClassError("Class not found");
  if (!row.offeringCrn) throw new MemberClassError("This class wasn't added from the timetable.");

  const offering = await prisma.courseOffering.findUnique({
    where: { termId_crn: { termId: row.termId, crn: row.offeringCrn } },
  });
  if (!offering) throw new MemberClassError("This section is no longer in the timetable.");

  const meetings = (row.meetings as unknown as PeriodMeeting[]) ?? [];
  const includeXHour = meetings.some((m) => m.kind === "xhour");
  // Reconstruct the destination from the stored pointers; google-calendar with the
  // saved calendarId re-creates events on the same calendar (dedicated/primary alike).
  const destination: ClassDestination =
    row.storage === "Google" && row.linkId
      ? { kind: "google-calendar", linkId: row.linkId, calendarId: row.calendarId ?? "primary" }
      : { kind: "local" };

  // Use the fresh period only if it's a code we can expand; otherwise keep the
  // class's current schedule and just refresh the location.
  const freshPeriod = offering.periodCode && getPeriod(offering.periodCode) ? offering.periodCode : null;
  const keepCustom = !freshPeriod && !row.periodCode ? meetings : undefined;

  await updateClass(classId, {
    userId,
    termId: row.termId,
    title: row.title,
    location: formatCourseLocation({ building: offering.building, room: offering.room }) || null,
    periodCode: freshPeriod ?? row.periodCode,
    includeXHour,
    customMeetings: keepCustom,
    destination,
    offeringCrn: row.offeringCrn,
    subject: offering.subject,
    courseNumber: offering.number,
    section: offering.section,
  });
}

// ── DTO + destination builders (used by the calendar loader) ─────────────────

function calendarLabel(row: { storage: string; linkId: string | null; calendarId: string | null }, links: CalendarLinkDTO[]): string {
  if (row.storage === "Local") return "In DALI only";
  const link = links.find((l) => l.id === row.linkId);
  const account = link?.displayName || link?.externalEmail || "Google";
  if (!row.calendarId || row.calendarId === "primary") return `${account} · Primary`;
  const sub = link?.subCalendars?.find((s) => s.id === row.calendarId);
  return `${account} · ${sub?.summary ?? DEDICATED_CALENDAR_NAME}`;
}

export function toMemberClassDTO(
  row: {
    id: string;
    title: string;
    periodCode: string | null;
    meetings: unknown;
    location: string | null;
    storage: string;
    linkId: string | null;
    calendarId: string | null;
    termId: string;
    offeringCrn: string | null;
    subject: string | null;
    courseNumber: string | null;
    section: string | null;
  },
  links: CalendarLinkDTO[],
): MemberClassDTO {
  return {
    id: row.id,
    title: row.title,
    periodCode: row.periodCode,
    meetings: (row.meetings as ClassMeetingDTO[]) ?? [],
    location: row.location,
    storage: row.storage === "Google" ? "Google" : "Local",
    linkId: row.linkId,
    calendarId: row.calendarId,
    destinationLabel: calendarLabel(row, links),
    termId: row.termId,
    offeringCrn: row.offeringCrn,
    subject: row.subject,
    courseNumber: row.courseNumber,
    section: row.section,
  };
}

/** The destinations the add-class form offers: each connected Google account
 *  (a dedicated Classes calendar, and either the account's sub-calendars or
 *  its primary as a fallback). No local-only option — classes must sync to
 *  Google so they appear in a real calendar. */
export function buildClassDestinations(links: CalendarLinkDTO[]): ClassDestinationDTO[] {
  const out: ClassDestinationDTO[] = [];
  for (const link of links) {
    if (link.provider !== "Google") continue;
    const account = link.displayName || link.externalEmail || "Google";
    out.push({ kind: "google-dedicated", linkId: link.id, label: `${account} · Classes calendar` });
    if (link.subCalendars && link.subCalendars.length > 0) {
      for (const sub of link.subCalendars) {
        out.push({
          kind: "google-calendar",
          linkId: link.id,
          calendarId: sub.id,
          label: `${account} · ${sub.primary ? "Primary" : sub.summary}`,
        });
      }
    } else {
      out.push({ kind: "google-primary", linkId: link.id, label: `${account} · Primary` });
    }
  }
  return out;
}
