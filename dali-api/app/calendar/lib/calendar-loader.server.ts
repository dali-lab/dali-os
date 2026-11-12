import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { cachedExternalRead } from "~/calendar/lib/external-cache.server";
import { isImpersonating, redirectNonMemberToPortal, requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms, currentTerm, getUserRoleInstances, isCore, isLabMember } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { buildClassDestinations, toMemberClassDTO } from "~/lib/member-class.server";
import { type CalendarEvent, fetchCalendarEvents, getValidAccessTokenForLink } from "~/calendar/lib/google-calendar.server";
import { generalCalendarState, isGeneralCalendarEvent } from "~/calendar/lib/general-calendar";
import { noteForOccurrence } from "~/lib/meeting-occurrences";
import { resolveUserTimeZone } from "~/lib/timezone";
import { meetingLinkRedirect } from "~/calendar/lib/meeting-link.server";
import { fetchWindow, parseView, viewWindow, weekWindow } from "~/calendar/lib/view-window";
import type { ClassDestinationDTO, ExternalEventDTO, LoaderData, MemberClassDTO } from "~/calendar/lib/types";
import { DEFAULT_BUFFER_MIN, DEFAULT_EVENT_DURATION_MIN, EVENT_DURATION_OPTIONS, assembleWorkingHours } from "~/calendar/lib/calendar-defaults";
import { GOOGLE_RSVP_LABEL, externalAttendees, externalLinks, fetchCachedCalendarList, meetingsForExternalEvents, viewerOnEvent } from "~/calendar/lib/calendar-external.server";
import { buildCalendarLinkDTO } from "~/calendar/lib/calendar-participants.server";

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

function calendarWindows(request: Request, timezone: string) {
  const url = new URL(request.url);
  // `?anchor=` is the unified screen's date param; `?weekStart=` is the legacy
  // week-nav param (still honored). Either anchors the visible range. It is
  // built at noon UTC of the requested calendar date so getZonedYMD resolves to
  // the intended local Y/M/D in any supported timezone.
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
  // The range the unified screen actually shows: the week in week view, wider
  // in month view, one day in day view.
  const { start: rangeStart, end: rangeEnd } = viewWindow(timezone, view, anchor);
  // Fetch wide, display narrow. Blocks outside the visible days are dropped by
  // placeBlock, so over-fetching is free on the client and saves a round-trip
  // on every view switch.
  const { start: fetchStart, end: fetchEnd } = fetchWindow(timezone, anchor);
  return { view, weekStart, weekEnd, rangeStart, rangeEnd, fetchStart, fetchEnd };
}

// Rolling window of ~8 weeks either side of the visible week, so the timesheet
// prefill form has recent entries to copy from and a month view has headroom.
// Bounded at BOTH ends on purpose: with only a lower bound, `date desc` + take
// 200 always returns the most recent 200 entries overall, so navigating back to
// an earlier week drew nothing and made past logged hours look lost.
function timeEntryQueryFor(userId: string, weekStart: Date, weekEnd: Date) {
  return {
    where: {
      userId,
      date: {
        gte: new Date(weekStart.getTime() - 8 * 7 * 86_400_000),
        lte: new Date(weekEnd.getTime() + 8 * 7 * 86_400_000),
      },
    },
    orderBy: { date: "desc" },
    take: 200,
    select: {
      id: true,
      source: true,
      scheduledMeetingId: true,
      sourceEventId: true,
      assignmentType: true,
      roleRefId: true,
      projectId: true,
      date: true,
      hours: true,
      note: true,
      startTime: true,
      endTime: true,
      occurrenceStart: true,
      meeting: { select: { notePages: { select: { id: true, meetingOccurrenceStart: true } } } },
    },
  } as const;
}

/**
 * @param opts.portal true when this is the /portal/calendar mount — the same
 *   calendar, read for a non-member (a Dartmouth student, or an external
 *   instructor). They get the personal half of it: their own working hours,
 *   their own linked Google calendars and events, and their classes this term.
 *   The lab's member and group directory is withheld, so the participant picker
 *   is empty and no meeting can be addressed to a member from there.
 */
export async function loadCalendarData(
  request: Request,
  opts: { portal?: boolean } = {},
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!opts.portal) {
    const portalRedirect = await redirectNonMemberToPortal(auth, request);
    if (portalRedirect) return portalRedirect;
    const meetingPage = await meetingLinkRedirect(new URL(request.url));
    if (meetingPage) return meetingPage;
  }

  const userId = auth.user.sub;

  // Keyed on the DALIMember row rather than the auth type, the same way the
  // member shell decides who it is for: a non-member instructor authenticates
  // as a "member" account and still belongs on the portal copy. On the portal
  // mount nothing else starts until this answers, so a redirected member never
  // triggers the Google token reads below.
  const labMemberP = isLabMember(userId, request);
  if (opts.portal && (await labMemberP)) return redirect("/calendar");

  // Every read starts here, before any Google call, so the Postgres round-trips
  // overlap each other and the Google chain instead of queuing behind it.
  // Prisma queries are lazy, so Promise.resolve is what actually starts them.
  const termP = currentTerm(request);
  const settingsP = Promise.resolve(
    prisma.userAvailabilitySettings.findUnique({
      where: { userId },
      select: {
        defaultEventBufferMin: true,
        timesheetGoogleSync: true,
        timesheetCalendarId: true,
      },
    }),
  );
  const userRowP = Promise.resolve(
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true, calendarDataChangedAt: true } }),
  );
  const whRowsP = Promise.resolve(
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
  );
  const linksP = Promise.resolve(
    prisma.userCalendarLink.findMany({
      where: { userId },
      orderBy: { linkedAt: "asc" },
    }),
  );
  const myRolesP = termP.then((term) => getUserRoleInstances(userId, term?.id, request));
  // Same gate as Forms: Core, Admin, or Instructor.
  const canSetSelfCheckInP = canViewForms(userId, request);
  const canMarkCoreMeetingP = isCore(userId, request);
  // Current+upcoming term ids for the class modal's term selector, and the
  // member's classes in those terms.
  const termFilterP = resolveTermFilter(request, { default: "upcoming" }).then(async (tf) => {
    const termIds = tf.termIds ?? [];
    const classRows = termIds.length
      ? await prisma.memberClass.findMany({
          where: { userId, termId: { in: termIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    return { ...tf, termIds, classRows };
  });

  // The whole calendar renders in the user's display zone (User.timeZone) —
  // the single source of truth shared with the rest of the app. Working hours
  // are stored as wall-clock minutes and drawn literally, so they follow it.
  const windowsP = userRowP.then((userRow) => calendarWindows(request, resolveUserTimeZone(userRow)));
  const timeEntryRowsP = windowsP.then(({ weekStart, weekEnd }) =>
    prisma.timeEntry.findMany(timeEntryQueryFor(userId, weekStart, weekEnd)),
  );

  // An admin impersonating this member sees the lab-native layers (meetings,
  // attendance, logged time) but none of their Google calendar: no event bodies,
  // and no access token minted against their Google account at all.
  const hideGoogle = isImpersonating(auth);
  let ingestionError: string | null = null;
  const googleP = Promise.all([linksP, userRowP, settingsP, windowsP]).then(
    async ([links, userRow, settings, { fetchStart, fetchEnd }]) => {
      const timesheetCalendarId = settings?.timesheetCalendarId ?? null;
      // Each Google link's calendar list (color tinting in fetchCalendarEvents
      // and the SubCalendar UI) is fetched ONCE per link and shared by both
      // consumers: one token read and one calendarList call per account.
      const googleLinks = hideGoogle ? [] : links.filter((l) => l.provider === "Google");
      const prefetchedTokens = new Map<string, string>();
      const calendarListResults = await Promise.all(
        googleLinks.map(async (l) => {
          try {
            const token = await getValidAccessTokenForLink(l.id);
            prefetchedTokens.set(l.id, token);
            const items = await fetchCachedCalendarList(userId, l.id, token, userRow?.calendarDataChangedAt);
            return { linkId: l.id, items } as const;
          } catch {
            return { linkId: l.id, items: undefined } as const;
          }
        }),
      );
      // linkId → list (undefined if the fetch failed).
      const prefetchedCalendarLists = new Map(
        calendarListResults.map(({ linkId, items }) => [linkId, items]),
      );
      const externalCacheKey = `${userId}:${fetchStart.getTime()}:${fetchEnd.getTime()}`;
      const [externalRaw, calendarLinks] = await Promise.all([
        // Read every calendar on each account ("all"), not just the ones counting
        // toward availability: the grid's per-calendar Show toggle filters this
        // client-side, so a calendar missing here can never be shown.
        hideGoogle
          ? Promise.resolve<CalendarEvent[]>([])
          : cachedExternalRead<CalendarEvent[]>(externalCacheKey, () =>
              fetchCalendarEvents(userId, fetchStart, fetchEnd, prefetchedCalendarLists, prefetchedTokens, "all"),
              userRow?.calendarDataChangedAt,
            ).catch((err): CalendarEvent[] => {
              ingestionError = err instanceof Error ? err.message : "Failed to fetch external events";
              return [];
            }),
        Promise.all(
          links.map((l) => buildCalendarLinkDTO(l, prefetchedCalendarLists, timesheetCalendarId)),
        ),
      ]);
      return { externalRaw, calendarLinks, timesheetCalendarId };
    },
  );

  // Events from the DALI Timesheet mirror calendar are dropped — the
  // logged-time layer already shows those hours, so keeping them would double
  // every work block. One meetings query for the whole window, not one per event.
  const externalP = Promise.all([googleP, canMarkCoreMeetingP, labMemberP]).then(
    async ([{ externalRaw, timesheetCalendarId }, canMarkCoreMeeting, labMember]) => {
      const crudEvents = externalRaw.filter(
        (e) => !timesheetCalendarId || e.calendarId !== timesheetCalendarId,
      );
      const eventMeetings = await meetingsForExternalEvents(
        crudEvents,
        userId,
        canMarkCoreMeeting,
        labMember,
      );
      return { crudEvents, eventMeetings };
    },
  );

  const [
    labMember,
    term,
    settings,
    whRows,
    myRoles,
    canSetSelfCheckIn,
    canMarkCoreMeeting,
    termFilter,
    timeEntryRows,
    { weekStart, weekEnd, rangeStart, rangeEnd, view },
    { calendarLinks },
    { crudEvents, eventMeetings },
  ] = await Promise.all([
    labMemberP,
    termP,
    settingsP,
    whRowsP,
    myRolesP,
    canSetSelfCheckInP,
    canMarkCoreMeetingP,
    termFilterP,
    timeEntryRowsP,
    windowsP,
    googleP,
    externalP,
  ]);
  const userRow = await userRowP;
  const timezone = resolveUserTimeZone(userRow);
  const bufferMin = settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN;

  // Group persisted rows by day-of-week (multiple segments allowed per day).
  const { workingHours, hasPersisted: hasAnyPersisted } = assembleWorkingHours(whRows);

  // Derived from the calendar lists already fetched above — no extra Google
  // round-trip.
  const generalCalendar = generalCalendarState(calendarLinks);

  // Map the external read to display DTOs, with edit identity
  // (eventId/linkId/writable/allDay).
  const externalEvents: ExternalEventDTO[] = crudEvents.map((e) => ({
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
    rsvp: e.responseStatus ? GOOGLE_RSVP_LABEL[e.responseStatus] : undefined,
    meeting: e.eventId ? eventMeetings.get(e.eventId) : undefined,
    // "Track in DALI" gives an event the meeting it never had, which is the
    // only way a plain event gets a note, a whiteboard or attendance after the
    // fact. Core can do it for the lab's general calendar; a member can do it
    // for any event they organize or are a guest on. The server re-checks.
    canTrackAsMeeting:
      Boolean(e.eventId) &&
      !eventMeetings.has(e.eventId) &&
      ((canMarkCoreMeeting && isGeneralCalendarEvent(e.calendarId)) ||
        (labMember && viewerOnEvent(e))),
  }));

  // Classes: load all current+upcoming terms for the modal picker.
  let memberClasses: MemberClassDTO[] = [];
  let classDestinations: ClassDestinationDTO[] = [];
  const selectableTermIds = termFilter.termIds;
  const classTerms = termFilter.terms
    .filter((t) => selectableTermIds.includes(t.id))
    .map((t) => ({ id: t.id, code: t.code }));

  if (selectableTermIds.length > 0) {
    memberClasses = termFilter.classRows.map((r) => toMemberClassDTO(r, calendarLinks));
    classDestinations = buildClassDestinations(calendarLinks);
  }

  const data: LoaderData = {
    timezone,
    defaultEventBufferMin: bufferMin,
    workingHours,
    hasPersistedWorkingHours: hasAnyPersisted,
    calendarLinks,
    generalCalendar,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    view,
    rangeStartIso: rangeStart.toISOString(),
    rangeEndIso: rangeEnd.toISOString(),
    externalEvents,
    ingestionError,
    googleHidden: hideGoogle,
    hasDirectory: labMember,
    currentUserId: userId,
    myRoles,
    canSetSelfCheckIn,
    canMarkCoreMeeting,
    timeEntries: timeEntryRows.map((t) => ({
      id: t.id,
      source: t.source,
      scheduledMeetingId: t.scheduledMeetingId,
      occurrenceStart: t.occurrenceStart ? t.occurrenceStart.toISOString() : null,
      sourceEventId: t.sourceEventId,
      manualBlockId: null,
      meetingNotePageId:
        t.meeting && t.occurrenceStart
          ? (noteForOccurrence(t.meeting.notePages, t.occurrenceStart)?.id ?? null)
          : null,
      assignmentType: t.assignmentType,
      roleRefId: t.roleRefId,
      projectId: t.projectId,
      date: t.date.toISOString(),
      hours: t.hours,
      note: t.note,
      startTime: t.startTime ? t.startTime.toISOString() : null,
      endTime: t.endTime ? t.endTime.toISOString() : null,
    })),
    classTerm: term ? { id: term.id, code: term.code } : null,
    classTerms,
    memberClasses,
    classDestinations,
    timesheetGoogleSync: settings?.timesheetGoogleSync ?? false,
    defaultEventDest: readCookie(request, "dali_event_dest"),
    defaultEventDurationMin: parseDurationCookie(readCookie(request, "dali_event_duration")),
  };
  return data;
}
