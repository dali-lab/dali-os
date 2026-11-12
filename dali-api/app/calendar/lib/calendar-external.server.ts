import { prisma } from "~/lib/db.server";
import { cachedExternalRead } from "~/calendar/lib/external-cache.server";
import { isLabMember } from "~/lib/roles";
import type { ScopeType } from "~/generated/prisma/client";
import { type CalendarEvent, listCalendarsForLink } from "~/lib/google-calendar";
import { isGeneralCalendarEvent } from "~/lib/general-calendar";
import { googleInstanceOriginalStart, googleSeriesBase, googleSeriesBaseUID, matchMeetingForEvent, noteForOccurrence, resolveOccurrence } from "~/lib/meeting-occurrences";
import type { EventAttendeeDTO, EventLinkDTO, EventMeetingDTO, RsvpStatus } from "~/calendar/lib/types";

// Google's responseStatus vocabulary → the labels the detail popover shows,
// shared with the DALI-native RSVP wording so one guest list reads the same
// whichever calendar the event came from.
export const GOOGLE_RSVP_LABEL: Record<
  "accepted" | "declined" | "tentative" | "needsAction",
  RsvpStatus
> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  needsAction: "Pending",
};

// Shared external-event → DTO mappers (both the busy read and the full
// calendar-crud read produce the same attendee/link shapes).
export function externalAttendees(
  atts: { name: string; responseStatus: "accepted" | "declined" | "tentative" | "needsAction"; organizer?: boolean; optional?: boolean }[] | undefined,
): EventAttendeeDTO[] | undefined {
  return atts?.map((a) => ({
    name: a.name,
    status: GOOGLE_RSVP_LABEL[a.responseStatus],
    organizer: a.organizer,
    optional: a.optional,
  }));
}
export function externalLinks(meetingUrl?: string, htmlLink?: string): EventLinkDTO[] {
  return [
    ...(meetingUrl ? [{ label: "Join video call", href: meetingUrl, kind: "video" as const }] : []),
    ...(htmlLink ? [{ label: "Open in Google Calendar", href: htmlLink, kind: "source" as const }] : []),
  ];
}

export const viewerOnEvent = (e: CalendarEvent): boolean =>
  e.organizerSelf === true || e.responseStatus !== undefined;

/**
 * The DALI meetings behind a set of Google events, keyed by the event id to
 * attach them to. A meeting DALI created records the Google event it made in
 * `externalEventId`; recurring series match on the master id, which every
 * expanded instance carries — so each occurrence of a weekly team meeting finds
 * the same meeting. Each instance then resolves to its own occurrence of it
 * (resolveOccurrence), which is what picks that week's notes doc and whether
 * that week is on the viewer's timesheet.
 *
 * Normally only meetings the viewer is part of are returned: seeing an event on
 * someone's shared calendar isn't grounds for reaching its attendance page.
 *
 * The DALI general calendar is the exception, and the reason this used to look
 * broken. It is the lab's own calendar — an event on it is addressed to the
 * whole lab by construction, whoever happens to be listed as a Google attendee
 * — so a lab member looking at one gets its note and attendance the same way
 * they would for a meeting they were invited to individually. Without this, a
 * lab-wide event showed a popover with no note and no attendance while every
 * other meeting on the grid had both.
 *
 * A viewer Google already has on the event — its organizer or a guest — sees
 * its tracked meeting even when the DALI roster missed them (an organizer
 * Google didn't list as a guest, for instance).
 */
export async function meetingsForExternalEvents(
  events: CalendarEvent[],
  userId: string,
  canMarkCoreMeeting: boolean,
  viewerIsLabMember: boolean,
): Promise<Map<string, EventMeetingDTO>> {
  const seriesIds = new Set<string>();
  // Stable RFC 5545 UIDs seen on the fetched events — the durable join key.
  const uidSet = new Set<string>();
  // Ids that reach the viewer through the general calendar, which admits any
  // lab member rather than only the invited.
  const labWideIds = new Set<string>();
  // Ids where Google itself says the viewer is on the event (organizer or
  // guest), independent of whether the DALI roster agrees.
  const viewerOnEventIds = new Set<string>();
  const admittedUIDs = new Set<string>();
  for (const e of events) {
    const labWide = viewerIsLabMember && isGeneralCalendarEvent(e.calendarId);
    const onEvent = viewerOnEvent(e);
    if (e.eventId) {
      seriesIds.add(e.eventId);
      if (labWide) labWideIds.add(e.eventId);
      if (onEvent) viewerOnEventIds.add(e.eventId);
    }
    if (e.recurringEventId) {
      seriesIds.add(e.recurringEventId);
      if (labWide) labWideIds.add(e.recurringEventId);
      if (onEvent) viewerOnEventIds.add(e.recurringEventId);
    }
    if (e.iCalUID) {
      uidSet.add(e.iCalUID);
      if (labWide || onEvent) admittedUIDs.add(e.iCalUID);
    }
  }
  const admittedIds = new Set([...labWideIds, ...viewerOnEventIds]);
  for (const id of [...seriesIds]) seriesIds.add(googleSeriesBase(id));
  for (const id of [...admittedIds]) admittedIds.add(googleSeriesBase(id));
  for (const uid of [...uidSet]) uidSet.add(googleSeriesBaseUID(uid));
  for (const uid of [...admittedUIDs]) admittedUIDs.add(googleSeriesBaseUID(uid));
  if (seriesIds.size === 0 && uidSet.size === 0) return new Map();
  const invited = [
    { organizerId: userId },
    { participantUserIds: { has: userId } },
  ];
  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      AND: [
        // Identity: the mutable event id (externalEventId) OR the stable RFC 5545
        // UID. The UID resolves an instance Google handed us detached — with no
        // recurringEventId to reach the master — which externalEventId can't.
        {
          OR:
            uidSet.size > 0
              ? [{ externalEventId: { in: [...seriesIds] } }, { iCalUID: { in: [...uidSet] } }]
              : [{ externalEventId: { in: [...seriesIds] } }],
        },
        // Access: the invited (organizer/participant), plus any lab member for an
        // event on the general calendar, plus any event Google itself says the
        // viewer is on.
        {
          OR: [
            ...invited,
            ...(admittedIds.size > 0 ? [{ externalEventId: { in: [...admittedIds] } }] : []),
            ...(admittedUIDs.size > 0 ? [{ iCalUID: { in: [...admittedUIDs] } }] : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      organizerId: true,
      externalEventId: true,
      iCalUID: true,
      googleEventOrigin: true,
      isCoreMeeting: true,
      meetingType: true,
      notebookId: true,
      participantUserIds: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      exceptions: {
        select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
      },
      notePages: { select: { id: true, meetingOccurrenceStart: true } },
      whiteboardPage: { select: { id: true } },
      timeEntries: { where: { userId }, select: { occurrenceStart: true } },
    },
  });
  // Stable-key + fallback indexes. iCalUID is shared across every attendee copy
  // and every instance of a series (see matchMeetingForEvent); externalEventId
  // is the mutable per-copy id we fall back to for un-backfilled rows.
  const byExternalId = new Map<string, (typeof meetings)[number]>();
  const byICalUID = new Map<string, (typeof meetings)[number]>();
  for (const m of meetings) {
    if (m.externalEventId) byExternalId.set(m.externalEventId, m);
    if (m.iCalUID) byICalUID.set(m.iCalUID, m);
  }
  // Backfill pass: a row whose iCalUID is still null resolves here through its
  // event id, so learn the UID off the event — index it in-memory so this
  // request's other (possibly detached) instances resolve by the stable key,
  // and persist it so a later single-instance view no longer needs a well-formed
  // sibling in the window. Best-effort; a failed write just retries next read.
  const heal = new Map<string, string>();
  for (const e of events) {
    if (!e.iCalUID || byICalUID.has(e.iCalUID)) continue;
    // Exact id match only: a split series' own `_R` UID must not land on the
    // parent row it merely falls back to.
    const m =
      (e.eventId ? byExternalId.get(e.eventId) : undefined) ??
      (e.recurringEventId ? byExternalId.get(e.recurringEventId) : undefined);
    if (!m) continue;
    byICalUID.set(e.iCalUID, m);
    if (!m.iCalUID) heal.set(m.id, e.iCalUID);
  }
  if (heal.size > 0) {
    await Promise.all(
      [...heal].map(([id, iCalUID]) =>
        prisma.scheduledMeeting.update({ where: { id }, data: { iCalUID } }).catch(() => {}),
      ),
    );
  }
  // Re-key onto the ids the events themselves carry, so an instance of a
  // recurring meeting resolves through its master (or, detached, its stable
  // iCalUID) — then down to its own occurrence.
  const byEventId = new Map<string, EventMeetingDTO>();
  for (const e of events) {
    if (!e.eventId) continue;
    const m = matchMeetingForEvent(e, byICalUID, byExternalId);
    if (!m) continue;
    const at = googleInstanceOriginalStart(e.eventId, e.recurringEventId) ?? new Date(e.startIso);
    const occurrence = resolveOccurrence(m, m.exceptions, at);
    const key = occurrence.originalStart.getTime();
    const isOrganizer = m.organizerId === userId;
    byEventId.set(e.eventId, {
      meetingId: m.id,
      occurrenceStart: occurrence.originalStart.toISOString(),
      notePageId: noteForOccurrence(m.notePages, occurrence.originalStart)?.id ?? null,
      whiteboardPageId: m.whiteboardPage?.id ?? null,
      hasType: m.meetingType != null,
      googleEventOrigin: m.googleEventOrigin,
      onTimesheet: m.timeEntries.some((t) => t.occurrenceStart?.getTime() === key),
      isCoreMeeting: m.isCoreMeeting,
      canMarkCoreMeeting,
      // Adding notes/whiteboards after the fact is the organizer's or Core's
      // call — the same authority the attach* helpers re-check server-side.
      // Once the meeting has notes, anyone in it opens the next occurrence's.
      canAddNote: isOrganizer || canMarkCoreMeeting,
      canOpenNote:
        ((m.meetingType != null && m.notePages.length > 0) || !!m.notebookId) &&
        (isOrganizer ||
          canMarkCoreMeeting ||
          m.participantUserIds.includes(userId) ||
          viewerOnEvent(e)),
      canAddWhiteboard: isOrganizer || canMarkCoreMeeting,
      canInvite: isOrganizer || canMarkCoreMeeting,
    });
  }
  return byEventId;
}

/**
 * Who may act on a meeting from its detail popover — logging it to their
 * timesheet, or marking it a Core meeting.
 *
 * The organizer and the invited, as before, plus any lab member on a
 * "None"-scoped meeting: that is the lab-wide kind, which is what an event on
 * the general calendar becomes once it's tracked. Those members can now see
 * such a meeting in the popover, so without this last clause the popover would
 * hand them controls that 403.
 */
export async function canActOnMeeting(
  meeting: { organizerId: string; participantUserIds: string[]; scopeType: ScopeType },
  userId: string,
  request: Request,
): Promise<boolean> {
  if (meeting.organizerId === userId) return true;
  if (meeting.participantUserIds.includes(userId)) return true;
  if (meeting.scopeType !== "None") return false;
  return isLabMember(userId, request);
}


/**
 * Cached calendarList read for one Google link, keyed by user so
 * invalidateExternalCache's `${userId}:` prefix match drops it along with the
 * events read. Exported for its own unit test — the loader that calls it pulls
 * in too much (auth, every other calendar table) to drive directly.
 */
export async function fetchCachedCalendarList(
  userId: string,
  linkId: string,
  token: string,
  changedAt?: Date | null,
) {
  return cachedExternalRead(`${userId}:calendar-list:${linkId}`, () => listCalendarsForLink(linkId, token), changedAt);
}
