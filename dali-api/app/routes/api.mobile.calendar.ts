import type { Route } from "./+types/api.mobile.calendar";
import { prisma } from "~/lib/db";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";
import { fetchCalendarEvents } from "~/lib/google-calendar";
import { expandClassOccurrences } from "~/calendar/lib/class-schedule";
import type { PeriodMeeting } from "~/calendar/lib/dartmouth-periods";
import {
  googleRsvp,
  inviteForOccurrence,
  inviteRsvp,
  parseCalendarRange,
  type MobileRsvp,
} from "~/lib/mobile-format";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

type EventOut = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  category: "dali" | "interview" | "class" | "personal";
  rsvp: MobileRsvp;
  rsvpNotificationId: string | null;
  calendar: string;
  attendeeIds: string[];
  description: string | null;
  link: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const url = new URL(request.url);
  const range = parseCalendarRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!range.ok) return mobileError(range.error, 400);
  const { from, to } = range;

  const [meetings, external, classes] = await Promise.all([
    listUpcomingMeetings(userId, from, to),
    fetchCalendarEvents(userId, from, to, undefined, undefined, "all").catch(() => []),
    prisma.memberClass.findMany({
      where: { userId, term: { startDate: { lte: to }, endDate: { gte: from } } },
      select: {
        id: true,
        title: true,
        meetings: true,
        location: true,
        storage: true,
        googleEventIds: true,
        term: { select: { startDate: true, endDate: true } },
      },
    }),
  ]);

  const meetingIds = [...new Set(meetings.flatMap((m) => (m.scheduledMeetingId ? [m.scheduledMeetingId] : [])))];
  const invites = meetingIds.length
    ? await prisma.notification.findMany({
        where: { recipientUserId: userId, kind: "MeetingInvite", scheduledMeetingId: { in: meetingIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, scheduledMeetingId: true, occurrenceStart: true, rsvp: true },
      })
    : [];

  const events: EventOut[] = meetings.map((m) => {
    if (m.source === "interview") {
      return {
        id: `interview:${m.id}`,
        title: m.title,
        start: m.startsAt,
        end: m.endsAt,
        isAllDay: false,
        location: m.location,
        meetingUrl: m.meetingUrl,
        category: "interview",
        rsvp: "accepted",
        rsvpNotificationId: null,
        calendar: "DALI OS",
        attendeeIds: m.attendeeIds,
        description: null,
        link: `/hiring/interviews/${m.id}`,
      };
    }
    const invite = inviteForOccurrence(invites, m.id, m.occurrenceStart);
    return {
      id: `dali:${m.id}:${m.occurrenceStart}`,
      title: m.title,
      start: m.startsAt,
      end: m.endsAt,
      isAllDay: false,
      location: m.location,
      meetingUrl: m.meetingUrl,
      category: "dali",
      rsvp: invite ? inviteRsvp(invite.rsvp) : "accepted",
      rsvpNotificationId: invite?.id ?? null,
      calendar: "DALI OS",
      attendeeIds: m.attendeeIds,
      description: m.description,
      link: `/calendar?meeting=${m.id}`,
    };
  });

  const classByGoogleId = new Map<string, (typeof classes)[number]>();
  for (const c of classes) {
    if (c.storage === "Google") for (const gid of c.googleEventIds) classByGoogleId.set(gid, c);
  }
  for (const c of classes) {
    if (c.storage === "Google") continue;
    const occurrences = expandClassOccurrences(
      c.meetings as unknown as PeriodMeeting[],
      c.term.startDate,
      c.term.endDate,
      from,
      to,
    );
    for (const o of occurrences) {
      events.push({
        id: `class:${c.id}:${o.startIso}`,
        title: c.title,
        start: o.startIso,
        end: o.endIso,
        isAllDay: false,
        location: c.location,
        meetingUrl: null,
        category: "class",
        rsvp: "accepted",
        rsvpNotificationId: null,
        calendar: "Classes",
        attendeeIds: [],
        description: null,
        link: null,
      });
    }
  }

  const mirrored = new Set(meetings.flatMap((m) => [m.externalEventId, m.iCalUID].filter((v): v is string => Boolean(v))));
  for (const e of external) {
    if (mirrored.has(e.eventId) || (e.iCalUID && mirrored.has(e.iCalUID))) continue;
    if (e.responseStatus === "declined") continue;
    events.push({
      id: `google:${e.linkId}:${e.calendarId}:${e.eventId}`,
      title: e.title || "Busy",
      start: e.startIso,
      end: e.endIso,
      isAllDay: e.allDay,
      location: e.location ?? null,
      meetingUrl: e.meetingUrl ?? null,
      category: classByGoogleId.has(e.eventId) || (e.recurringEventId && classByGoogleId.has(e.recurringEventId)) ? "class" : "personal",
      rsvp: googleRsvp(e.responseStatus),
      rsvpNotificationId: null,
      calendar: e.calendarId,
      attendeeIds: [],
      description: e.description ?? null,
      link: e.htmlLink ?? null,
    });
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return mobileJson({ events });
}
