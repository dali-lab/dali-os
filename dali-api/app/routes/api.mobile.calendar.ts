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
import { listMemberSummaries } from "~/lib/mobile-members.server";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { createScheduledMeeting } from "~/lib/scheduled-meeting";

const CreateEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480),
  participantUserIds: z.array(z.string().min(1)).max(100).default([]),
  location: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(5000).nullish(),
  addToGoogle: z.boolean().default(true),
  addMeet: z.boolean().default(false),
});

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
  scheduledMeetingId: string | null;
  occurrenceStart: string | null;
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
        scheduledMeetingId: null,
        occurrenceStart: null,
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
      scheduledMeetingId: m.id,
      occurrenceStart: m.occurrenceStart,
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
        scheduledMeetingId: null,
        occurrenceStart: null,
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
      scheduledMeetingId: null,
      occurrenceStart: null,
    });
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  const people = await listMemberSummaries([...new Set(events.flatMap((e) => e.attendeeIds))]);
  return mobileJson({ events, people });
}

// POST — create a DALI meeting from the app, the way the web calendar does: an
// invite to each person (just you when nobody else is picked), and, when asked,
// a Google event on your linked calendar with an optional Meet link.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;
  const body = await parseJson(request, CreateEventSchema);
  if (body instanceof Response) return body;

  const [user, link] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { daliEmail: true, dartmouthEmail: true } }),
    body.addToGoogle
      ? prisma.userCalendarLink.findFirst({
          where: { userId, enabled: true },
          orderBy: [{ primary: "desc" }, { linkedAt: "asc" }],
          select: { id: true },
        })
      : null,
  ]);
  const organizerEmail = user?.daliEmail ?? user?.dartmouthEmail;
  if (!organizerEmail) return mobileError("Your account has no DALI or Dartmouth email to send invites from.", 400);

  const others = body.participantUserIds.filter((id) => id !== userId);
  const result = await createScheduledMeeting({
    organizerId: userId,
    organizerEmail,
    title: body.title,
    durationMinutes: body.durationMinutes,
    scope: { type: "UserList", participantUserIds: [userId, ...others] },
    startTime: body.startTime,
    location: body.location || null,
    description: body.description || null,
    organizerCalendarLinkId: link?.id ?? null,
    addMeet: Boolean(link) && body.addMeet,
    request,
  });
  if (!result.ok) return mobileError(result.error, 400);
  return mobileJson(
    { id: result.meeting.id, addedToGoogle: Boolean(link) && !result.gcalError, googleError: result.gcalError },
    { status: 201 },
  );
}
