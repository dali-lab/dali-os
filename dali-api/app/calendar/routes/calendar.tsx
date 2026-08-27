import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  Clock,
  Shield,
  CalendarDays,
  CalendarPlus,
  Building2,
  Wifi,
  UsersRound,
  X,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Pencil,
  MapPin,
  AlignLeft,
  Repeat,
  Copy,
  GripVertical,
} from "lucide-react";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { fullName } from "~/lib/display";
import { prisma } from "~/lib/db";
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
import { DARTMOUTH_PERIODS, getPeriod, periodSummary } from "~/calendar/lib/dartmouth-periods";
import { destinationValue, classScheduleSummary } from "~/calendar/lib/class-format";
import { CalendarActionSchema, validateTimeEntryRange } from "~/lib/calendar-schemas";
import { syncManualBlockTimeEntry } from "~/lib/time-entry-sync";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
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
  type GeneralCalendarState,
} from "~/lib/general-calendar";
import { getZonedHourFraction, getZonedYMD, resolveUserTimeZone, zonedDayStartUtc, zonedWallTimeUtc } from "~/lib/timezone";
import { formatPayPeriod, isPayPeriodEnd, payPeriodFor } from "~/lib/pay-period";
import { timeEntryDayUtc } from "~/calendar/lib/timesheet-day";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import type { Route } from "./+types/calendar";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { RsvpButtons } from "~/components/RsvpButtons";
import { CustomHiresManager } from "~/calendar/components/CustomHiresManager";
import { DateField } from "~/components/ui/DateField";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";
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
  EVENT_TEXT, EVENT_CORAL, AVAIL_DEEP_GREEN, availabilityTint,
  HOURS, HOUR_PX, INITIAL_SCROLL_HOUR, SUBDIVISIONS_PER_HOUR, SNAP_HOURS,
  RSVP_BADGE, DAY_KEYS, DAY_LABELS, ATTENDEE_DOT, GUESTS_COLLAPSED,
  durationMinutesBetween, toDatetimeLocal, dayHourToLocal,
  ROLE_COLOR_PALETTE, UNASSIGNED_ROLE_KEY, roleColor, timeEntryRoleKey,
  meetingBlockStyle, readableTextColor,
  nominalDayRange, localDayTimeToIso, todayDateInputValue,
  formatHour, formatHourMinute, formatBlockRange, shiftWeekParam,
} from "~/calendar/lib/event-block";
import {
  WeekGrid, WeekGridEvent, useNow, useRefreshOnFocus,
  workingHoursStripeLayer, DayBg, BlockBlock,
  SelectionPopoverPortal, CalendarEventDetailPopover,
  MeetingDetailToggles, EventGuestList,
  type AllDayBlock,
} from "~/calendar/components/WeekGrid";
import {
  buildGridDays,
  buildExternalLayer,
  buildBlocksLayer,
  buildMeetingsLayer,
  buildClassesLayer,
  buildAllDayItems,
  buildLoggedTimeLayer,
  buildLoggedSourceIndex,
  mergeLayers,
  perCalendarLegend,
  computeRoleBuckets,
  timeEntryRange,
  toGridRange,
  DEFAULT_LAYER_VISIBILITY,
  type LayerVisibility,
  type GridDay,
} from "~/calendar/lib/layers";
import { MonthGrid } from "~/calendar/components/MonthGrid";

// Underline subnav sits flush under the workspace tab bar (see layout embed padding).
// `areaSubnav` (not `areaPills`) because calendar renders its own day/week/month
// UnderlineTabButtons row unconditionally — it isn't the flag-gated AreaPillNav,
// so it reserves the flush top spacing regardless of the sidebar-redesign flag.
export const handle = {
  areaSubnav: true,
  docKey: "calendar",
  docTitle: "Calendar",
};

const DEFAULT_BUFFER_MIN = 15;
const DEFAULT_WORK_START_MIN = 9 * 60;
const DEFAULT_WORK_END_MIN = 17 * 60;

// Data DTOs, EventBlock, and group-availability types live in
// ~/calendar/lib/types (imported above) so the extracted components and the
// unified screen can share them without importing this server-coupled route.

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

function defaultWorkingHours(): WhDay[] {
  // Mon–Fri 9–5 InPerson, weekends disabled. The "default" segment lives only in
  // memory (no id) until the user persists it via the action handler.
  return Array.from({ length: 7 }).map((_, dow) => ({
    dayOfWeek: dow,
    segments:
      dow >= 1 && dow <= 5
        ? [
            {
              id: `default-${dow}`,
              startMinute: DEFAULT_WORK_START_MIN,
              endMinute: DEFAULT_WORK_END_MIN,
              location: "InPerson" as const,
            },
          ]
        : [],
  }));
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
  return v === "day" || v === "month" ? v : "week";
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

export async function loader({ request }: Route.LoaderArgs) {
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
  };
  return data;
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

export async function action({ request }: Route.ActionArgs) {
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

type Tab = "availability" | "schedule" | "timesheet";

const CALENDAR_TAB_STORAGE_KEY = "dali:calendar:tab";
const AVAILABILITY_SIDEBAR_COLLAPSED_KEY = "dali:calendar:availability:sidebar-collapsed";

export default function CalendarPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const unified = useFeatureFlag("calendar-unified");
  return unified ? <CalendarScreen data={data} /> : <LegacyCalendarTabs data={data} />;
}

function LegacyCalendarTabs({ data }: { data: LoaderData }) {
  const { os } = useOsChrome();
  const [searchParams] = useSearchParams();
  // Persist the active tab in sessionStorage so navigating away and back
  // (or the workspace iframe re-mounting on tab focus) restores where the
  // user left off rather than always snapping back to Availability.
  const [tab, setTab] = useState<Tab>(() => {
    // A deep link (e.g. a project hub's "Schedule meeting" button) wins over the
    // remembered tab, so `?tab=schedule` always lands on the scheduler.
    const urlTab = searchParams.get("tab");
    if (urlTab === "schedule" || urlTab === "timesheet" || urlTab === "availability") {
      return urlTab;
    }
    if (typeof window === "undefined") return "availability";
    try {
      const stored = window.sessionStorage.getItem(CALENDAR_TAB_STORAGE_KEY);
      return stored === "schedule" || stored === "timesheet" ? stored : "availability";
    } catch {
      return "availability";
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(CALENDAR_TAB_STORAGE_KEY, tab);
    } catch {
      // sessionStorage disabled / quota — ignore
    }
  }, [tab]);

  return (
    <div className={cn("flex flex-col", os ? "gap-4" : "gap-5")}>
      <UnderlineTabButtons
        label="Calendar"
        // Under os the page title shares the switcher's line, the switcher
        // pushed to the far right; the brand shell has no title here.
        heading={
          os ? (
            <h1 className="font-heading text-4xl font-medium text-foreground">Calendar</h1>
          ) : undefined
        }
        items={[
          {
            label: "My Availability",
            active: tab === "availability",
            onClick: () => setTab("availability"),
            icon: CalendarDays,
          },
          {
            label: "Schedule Meeting",
            active: tab === "schedule",
            onClick: () => setTab("schedule"),
            icon: CalendarPlus,
          },
          {
            label: "Timesheet",
            active: tab === "timesheet",
            onClick: () => setTab("timesheet"),
            icon: Clock,
          },
        ]}
      />

      {tab === "availability" && <AvailabilityView data={data} />}
      {tab === "schedule" && <ScheduleView data={data} />}
      {tab === "timesheet" && <TimesheetView data={data} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unified calendar (behind the `calendar-unified` flag)               */
/* ------------------------------------------------------------------ */

const CALENDAR_LAYERS_KEY = "dali:calendar:layers";
const CALENDAR_HIDDEN_CALS_KEY = "dali:calendar:hiddenCals";
const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day" };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymdUtc(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// One screen, three views, toggleable colored layers. Scheduling and timesheet
// are reachable from the Create menu (they reuse the existing Schedule/Timesheet
// UIs); day-to-day browsing is the layered grid. Deep links from the old tabs
// (?tab=schedule|timesheet) translate to the matching mode/layer.
function CalendarScreen({ data }: { data: LoaderData }) {
  const { os, panel } = useOsChrome();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  useRefreshOnFocus(refresh);
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<"browse" | "meeting" | "timesheet">(() => {
    const t = searchParams.get("tab");
    if (t === "schedule") return "meeting";
    if (t === "timesheet") return "timesheet";
    return "browse";
  });

  const [layers, setLayers] = useState<LayerVisibility>(() => {
    const base: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
    if (searchParams.get("tab") === "timesheet") base.logged = true;
    if (typeof window === "undefined") return base;
    try {
      const stored = window.localStorage.getItem(CALENDAR_LAYERS_KEY);
      if (stored) return { ...base, ...(JSON.parse(stored) as Partial<LayerVisibility>) };
    } catch {
      /* ignore */
    }
    return base;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(CALENDAR_LAYERS_KEY, JSON.stringify(layers));
    } catch {
      /* ignore */
    }
  }, [layers]);
  const toggleLayer = (key: keyof LayerVisibility) => setLayers((p) => ({ ...p, [key]: !p[key] }));

  const [excludedRoleKeys, setExcludedRoleKeys] = useState<Set<string>>(new Set());
  const toggleRoleKey = (key: string) =>
    setExcludedRoleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Linked calendars hidden on the grid (display only — still fetched, still
  // count for availability). Persisted so a hidden calendar stays hidden.
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(CALENDAR_HIDDEN_CALS_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(CALENDAR_HIDDEN_CALS_KEY, JSON.stringify([...hiddenCals]));
    } catch {
      /* ignore */
    }
  }, [hiddenCals]);
  const toggleHiddenCal = (id: string) =>
    setHiddenCals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [createOpen, setCreateOpen] = useState(false);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [classesOpen, setClassesOpen] = useState(false);
  const [calMgrOpen, setCalMgrOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // The tentative block drawn on the grid while a create composer is open, so a
  // dragged-out event stays visible (and tracks the composer's time edits)
  // instead of vanishing the moment the popover appears.
  const [createSel, setCreateSel] = useState<{ dayIdx: number; startHour: number; endHour: number } | null>(null);
  const closeComposer = () => {
    setComposer(null);
    setCreateSel(null);
  };
  const eventMoveFetcher = useFetcher();
  // Drag-move/resize of a writable event → patch just its time (same calendar
  // day, new hours), in the display timezone.
  const moveEvent = (e: ExternalEventDTO, startHour: number, endHour: number) => {
    if (!e.eventId || !e.linkId) return;
    const { year, month, day } = getZonedYMD(new Date(e.startIso), data.timezone);
    const toIso = (h: number) => {
      const mins = Math.round(h * 60);
      return zonedWallTimeUtc(year, month, day, Math.floor(mins / 60), mins % 60, data.timezone).toISOString();
    };
    eventMoveFetcher.submit(
      {
        intent: "event-move",
        destination: `${e.linkId}:${e.calendarId ?? "primary"}`,
        eventId: e.eventId,
        startIso: toIso(startHour),
        endIso: toIso(endHour),
        timeZone: data.timezone,
      },
      { method: "post" },
    );
  };
  // In-app blocks edit/move through the SAME composer as Google events — the
  // block is presented to the composer as a local-destination "event".
  const editBlock = (b: ManualBlockDTO, anchor?: DOMRect) =>
    setComposer({
      mode: "edit",
      anchor,
      event: {
        startIso: b.startTime,
        endIso: b.endTime,
        title: b.title,
        color: null,
        writable: true,
        allDay: false,
        manualBlockId: b.id,
        isWork: b.isWork,
        assignmentType: b.assignmentType,
        roleRefId: b.roleRefId,
        workNote: b.workNote,
      },
    });
  const moveBlock = (b: ManualBlockDTO, startHour: number, endHour: number) => {
    const { year, month, day } = getZonedYMD(new Date(b.startTime), data.timezone);
    const toIso = (h: number) => {
      const mins = Math.round(h * 60);
      return zonedWallTimeUtc(year, month, day, Math.floor(mins / 60), mins % 60, data.timezone).toISOString();
    };
    eventMoveFetcher.submit(
      {
        intent: "event-move",
        destination: LOCAL_DEST,
        manualBlockId: b.id,
        startIso: toIso(startHour),
        endIso: toIso(endHour),
        timeZone: data.timezone,
      },
      { method: "post" },
    );
  };
  // Detail-popover Duplicate: open the composer in create mode, prefilled from
  // the event/block (a fresh event — identity fields are dropped).
  const duplicateEvent = (e: ExternalEventDTO, anchor?: DOMRect) =>
    setComposer({ mode: "create", anchor, seed: e });
  const duplicateBlock = (b: ManualBlockDTO, anchor?: DOMRect) =>
    setComposer({
      mode: "create",
      anchor,
      seed: {
        startIso: b.startTime,
        endIso: b.endTime,
        title: b.title,
        color: null,
        writable: true,
        allDay: false,
        manualBlockId: b.id, // drives the destination default → in-app
        isWork: b.isWork,
        assignmentType: b.assignmentType,
        roleRefId: b.roleRefId,
        workNote: b.workNote,
      },
    });
  // Detail-popover Delete. Recurring events need the this/following/all scope
  // prompt, so route those through the composer; one-offs delete straight away.
  const deleteEvent = (e: ExternalEventDTO) => {
    if (!e.eventId || !e.linkId) return;
    if (e.recurringEventId) {
      setComposer({ mode: "edit", event: e });
      return;
    }
    eventMoveFetcher.submit(
      {
        intent: "event-delete",
        destination: `${e.linkId}:${e.calendarId ?? "primary"}`,
        eventId: e.eventId,
        manualBlockId: "",
        scope: "this",
        recurringEventId: "",
        originalStartIso: e.startIso ?? "",
      },
      { method: "post" },
    );
  };
  const deleteBlock = (b: ManualBlockDTO) =>
    eventMoveFetcher.submit(
      {
        intent: "event-delete",
        destination: LOCAL_DEST,
        manualBlockId: b.id,
        eventId: "",
        scope: "this",
        recurringEventId: "",
        originalStartIso: "",
      },
      { method: "post" },
    );
  // One grid editor slot, shared by drag-to-create (a new block/entry) and
  // click-to-edit (an existing logged-time block). The active layer/action
  // decides which the drag means; a logged block click always edits.
  type CalendarEditor =
    | { kind: "create"; dayIdx: number; startHour: number; endHour: number; startLocal: string; endLocal: string }
    | {
        kind: "edit";
        entry: TimeEntryDTO;
        dayIdx: number;
        startHour: number;
        endHour: number;
        startLocal: string;
        endLocal: string;
      };
  const [editor, setEditor] = useState<CalendarEditor | null>(null);

  const view = data.view;
  const rangeStart = new Date(data.rangeStartIso);
  const dayCount = Math.max(
    1,
    Math.round((new Date(data.rangeEndIso).getTime() - rangeStart.getTime()) / 86_400_000),
  );
  const days = buildGridDays(data.rangeStartIso, dayCount);
  // The date the view is centered on (prev/next math + the month label). For
  // month view rangeStart is the Sunday before the 1st, so +14d lands mid-month.
  const focusDate = view === "month" ? new Date(rangeStart.getTime() + 14 * 86_400_000) : rangeStart;
  const anchorMonth = { year: focusDate.getUTCFullYear(), month: focusDate.getUTCMonth() + 1 };

  const setParams = (mut: (p: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        mut(p);
        return p;
      },
      { preventScrollReset: true },
    );
  const changeView = (v: CalendarView) =>
    setParams((p) => {
      p.set("view", v);
      p.set("anchor", ymdUtc(focusDate));
      p.delete("weekStart");
    });
  const navigate = (delta: number) => {
    const d = new Date(focusDate);
    if (view === "day") d.setUTCDate(d.getUTCDate() + delta);
    else if (view === "week") d.setUTCDate(d.getUTCDate() + delta * 7);
    else d.setUTCMonth(d.getUTCMonth() + delta);
    setParams((p) => {
      p.set("view", view);
      p.set("anchor", ymdUtc(d));
      p.delete("weekStart");
    });
  };
  const goToday = () =>
    setParams((p) => {
      p.set("view", view);
      p.delete("anchor");
      p.delete("weekStart");
    });
  const goToDay = (dateUtc: Date) =>
    setParams((p) => {
      p.set("view", "day");
      p.set("anchor", ymdUtc(dateUtc));
      p.delete("weekStart");
    });

  // Keyboard nav (Google-Calendar style): D/W/M switch view, T jumps to today,
  // ←/→ page. Only in browse mode, never while a dialog is open or while typing
  // into a field. Modifier chords are left for the browser/OS.
  const anyModalOpen = Boolean(composer) || settingsOpen || classesOpen || calMgrOpen || createOpen;
  useEffect(() => {
    if (mode !== "browse" || anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      switch (e.key.toLowerCase()) {
        case "d": changeView("day"); break;
        case "w": changeView("week"); break;
        case "m": changeView("month"); break;
        case "t": goToday(); break;
        case "arrowleft": navigate(-1); break;
        case "arrowright": navigate(1); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // changeView/goToday/navigate close over view + focusDate (derived from
    // rangeStartIso); re-bind when the visible range or view changes.
  }, [mode, anyModalOpen, view, data.rangeStartIso]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the logged layer is on, an event that's also logged (a meeting or a
  // work-block) shows a role accent on its own block rather than a second
  // overlapping logged block. Index the sourced entries so the meeting/block
  // layers can annotate, and the logged layer can skip them (only where that
  // source layer is actually visible — a hidden meeting still needs its block).
  const loggedIndex = layers.logged ? buildLoggedSourceIndex(data, excludedRoleKeys) : null;

  const layerMaps: Record<number, EventBlock[]>[] = [];
  if (layers.external)
    layerMaps.push(
      buildExternalLayer(
        data,
        days,
        hiddenCals,
        data.crudEnabled ? (e, anchor) => setComposer({ mode: "edit", event: e, anchor }) : undefined,
        data.crudEnabled ? moveEvent : undefined,
        data.crudEnabled ? duplicateEvent : undefined,
        data.crudEnabled ? deleteEvent : undefined,
      ),
    );
  // All-day events (crud read) render in the grid's all-day band.
  const allDayByDay: Record<number, AllDayBlock[]> = {};
  if (data.crudEnabled) {
    const items = buildAllDayItems(data, days, hiddenCals);
    for (const [idx, evs] of Object.entries(items)) {
      allDayByDay[Number(idx)] = evs.map((e) => ({
        label: e.title,
        color: e.color,
        onClick:
          e.writable && e.eventId
            ? (ev) => setComposer({ mode: "edit", event: e, anchor: ev.currentTarget.getBoundingClientRect() })
            : undefined,
      }));
    }
  }
  if (layers.blocks)
    layerMaps.push(
      buildBlocksLayer(
        data,
        days,
        loggedIndex?.byBlock,
        data.crudEnabled ? editBlock : undefined,
        data.crudEnabled ? moveBlock : undefined,
        data.crudEnabled ? duplicateBlock : undefined,
        data.crudEnabled ? deleteBlock : undefined,
      ),
    );
  if (layers.meetings) layerMaps.push(buildMeetingsLayer(data, days, loggedIndex?.byMeeting));
  if (data.classesEnabled && layers.classes) layerMaps.push(buildClassesLayer(data, days));
  if (layers.logged)
    layerMaps.push(
      buildLoggedTimeLayer(data, days, {
        excludedRoleKeys,
        suppressSourced: { meetings: layers.meetings, blocks: layers.blocks },
        onEntryClick: (t, startIso, endIso) => {
          const { dayIdx, startHour, endHour } = toGridRange(days, data.timezone, startIso, endIso);
          const day = days[dayIdx];
          if (!day) return;
          setEditor({
            kind: "edit",
            entry: t,
            dayIdx,
            startHour,
            endHour,
            startLocal: dayHourToLocal(day.dateUtc, startHour),
            endLocal: dayHourToLocal(day.dateUtc, endHour),
          });
        },
      }),
    );
  const eventsByDay = mergeLayers(...layerMaps);

  // Keep the tentative create block in step with the composer's time edits. An
  // all-day or off-grid draft drops the block (nothing sensible to draw).
  const syncCreateSel = (startIso: string, endIso: string, isAllDay: boolean) => {
    if (isAllDay || !startIso || !endIso) {
      setCreateSel(null);
      return;
    }
    const { dayIdx, startHour, endHour } = toGridRange(days, data.timezone, startIso, endIso);
    if (dayIdx < 0 || dayIdx >= days.length) {
      setCreateSel((p) => (p ? null : p));
      return;
    }
    setCreateSel((p) =>
      p && p.dayIdx === dayIdx && p.startHour === startHour && p.endHour === endHour
        ? p
        : { dayIdx, startHour, endHour },
    );
  };

  // Logged-time summary: hours per role across the pay period the visible week
  // belongs to (matches the Timesheet grid's period totals).
  const weekPeriod = payPeriodFor(new Date(data.weekStartIso));
  const periodEntries = data.timeEntries.filter(
    (t) => payPeriodFor(timeEntryDayUtc(t, data.timezone)).index === weekPeriod.index,
  );
  const rangeEndMs = new Date(data.rangeEndIso).getTime();
  const drawnEntries = data.timeEntries.filter((t) => {
    const start = new Date(timeEntryRange(t, data.timezone).startIso).getTime();
    return start >= rangeStart.getTime() && start < rangeEndMs;
  });
  const roleBuckets = computeRoleBuckets(data, periodEntries, drawnEntries);

  const df = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: data.timezone, ...opts }).format(d);
  let rangeLabel: string;
  if (view === "day") rangeLabel = df(focusDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  else if (view === "month") rangeLabel = df(focusDate, { month: "long", year: "numeric" });
  else {
    const last = days[days.length - 1].dateUtc;
    rangeLabel = `${df(rangeStart, { month: "short", day: "numeric" })} – ${df(last, {
      month: "short",
      day: "numeric",
    })}, ${df(last, { year: "numeric" })}`;
  }

  // Open the scheduling overlay (from the New menu). A meeting's time comes from
  // the group's availability, so there's no slot to carry in — it's picked on
  // the availability grid after participants are chosen.
  const startMeeting = () => {
    setEditor(null);
    setMode("meeting");
  };
  // Open the unified create popover at a sensible default slot (today if it's in
  // range, 9–10am) — the New-menu path when there's no drag. Month view has no
  // time grid, so switch to week first.
  const openQuickCreate = () => {
    if (view === "month") {
      changeView("week");
      return;
    }
    const nowKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const found = days.findIndex((d) => ymdUtc(d.dateUtc) === nowKey);
    const idx = found >= 0 ? found : 0;
    const day = days[idx];
    if (!day) return;
    setEditor({
      kind: "create",
      dayIdx: idx,
      startHour: 9,
      endHour: 10,
      startLocal: dayHourToLocal(day.dateUtc, 9),
      endLocal: dayHourToLocal(day.dateUtc, 10),
    });
  };

  const navBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  const iconToolBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium text-foreground hover:bg-muted";

  return (
    <div className={cn("flex flex-col", os ? "gap-3" : "gap-4")}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" className={navBtn} onClick={() => navigate(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Today
          </button>
          <button type="button" className={navBtn} onClick={() => navigate(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{rangeLabel}</h1>

        <div className="ml-auto flex items-center gap-2">
          {mode === "browse" && (
            <>
              <div className="inline-flex rounded-lg bg-muted p-0.5">
                {(["month", "week", "day"] as CalendarView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => changeView(v)}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                      v === view ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              </div>

              <Tooltip content="Calendar settings">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Calendar settings"
                  className={cn(iconToolBtn, "w-8 justify-center px-0")}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </Tooltip>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setCalendarsOpen((o) => !o)}
                  aria-expanded={calendarsOpen}
                  className={iconToolBtn}
                >
                  <SlidersHorizontal className="h-4 w-4" /> Calendars <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {calendarsOpen && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default"
                      aria-hidden
                      onClick={() => setCalendarsOpen(false)}
                      tabIndex={-1}
                    />
                    <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-brand-2">
                      <CalendarLayerList
                        layers={layers}
                        toggleLayer={toggleLayer}
                        calendars={perCalendarLegend(data)}
                        hiddenCals={hiddenCals}
                        toggleHiddenCal={toggleHiddenCal}
                        roleBuckets={layers.logged ? roleBuckets : []}
                        excludedRoleKeys={excludedRoleKeys}
                        toggleRoleKey={toggleRoleKey}
                        classesEnabled={data.classesEnabled}
                        classCount={data.memberClasses.length}
                        localClassCount={data.memberClasses.filter((c) => c.storage === "Local").length}
                        onManageClasses={() => {
                          setCalendarsOpen(false);
                          setClassesOpen(true);
                        }}
                        onOpenSettings={() => {
                          setCalendarsOpen(false);
                          setSettingsOpen(true);
                        }}
                        crudEnabled={data.crudEnabled}
                        onManageCalendars={() => {
                          setCalendarsOpen(false);
                          setCalMgrOpen(true);
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setCreateOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral-light"
            >
              <Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {createOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-hidden
                  onClick={() => setCreateOpen(false)}
                  tabIndex={-1}
                />
                <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-brand-2">
                  {data.crudEnabled ? (
                    // One "Event" — where it lives (in app vs a Google calendar)
                    // is just the destination chosen inside the composer.
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      onClick={(e) => {
                        setComposer({ mode: "create", anchor: e.currentTarget.getBoundingClientRect() });
                        setCreateOpen(false);
                      }}
                    >
                      <CalendarPlus className="h-4 w-4 text-muted-foreground" /> Event
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      onClick={() => {
                        openQuickCreate();
                        setCreateOpen(false);
                      }}
                    >
                      <Plus className="h-4 w-4 text-muted-foreground" /> Event / log time
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    onClick={() => {
                      startMeeting();
                      setCreateOpen(false);
                    }}
                  >
                    <CalendarPlus className="h-4 w-4 text-muted-foreground" /> Meeting
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {mode === "meeting" ? (
        <section className="flex flex-col gap-3">
          <BackToCalendarBar label="Schedule a meeting" onBack={() => setMode("browse")} />
          <MeetingComposer data={data} />
        </section>
      ) : mode === "timesheet" ? (
        <section className="flex flex-col gap-3">
          <BackToCalendarBar label="Timesheet" onBack={() => setMode("browse")} />
          <TimesheetView data={data} />
        </section>
      ) : (
        <div className="flex flex-col lg:h-[max(calc(100vh-9rem),56rem)] lg:min-h-0">
          <section className={cn(panel, "flex flex-col p-3 lg:flex-1 lg:min-h-0")}>
              {view === "month" ? (
                <MonthGrid
                  days={days}
                  eventsByDay={eventsByDay}
                  anchorMonth={anchorMonth}
                  timezone={data.timezone}
                  onSelectDay={goToDay}
                />
              ) : (
                <WeekGrid
                  fillAndScroll
                  clean
                  days={days}
                  timezone={data.timezone}
                  markPayPeriodEnds={layers.logged}
                  backgroundLayer={(dayIdx) =>
                    layers.workingHours
                      ? workingHoursStripeLayer(data.workingHours, days[dayIdx].dayOfWeek, {
                          enabled: data.hasPersistedWorkingHours,
                        })
                      : null
                  }
                  eventsByDay={eventsByDay}
                  allDayByDay={allDayByDay}
                  onDayPointerSelect={(dayIdx, startHour, endHour, anchorRect) => {
                    const day = days[dayIdx];
                    if (!day) return;
                    const startLocal = dayHourToLocal(day.dateUtc, startHour);
                    const endLocal = dayHourToLocal(day.dateUtc, endHour);
                    // With Google CRUD on, dragging drafts a real event; otherwise
                    // it drafts an in-app block.
                    if (data.crudEnabled) {
                      setCreateSel({ dayIdx, startHour, endHour });
                      setComposer({ mode: "create", startLocal, endLocal, anchor: anchorRect });
                      return;
                    }
                    setEditor({ kind: "create", dayIdx, startHour, endHour, startLocal, endLocal });
                  }}
                  selection={
                    editor
                      ? { dayIdx: editor.dayIdx, startHour: editor.startHour, endHour: editor.endHour }
                      : createSel
                  }
                  selectionPopover={
                    editor
                      ? () =>
                          editor.kind === "edit" ? (
                            <TimesheetEditPopover
                              entry={editor.entry}
                              startLocal={editor.startLocal}
                              endLocal={editor.endLocal}
                              myRoles={data.myRoles}
                              onClose={() => setEditor(null)}
                            />
                          ) : (
                            <CreateFromDragPopover
                              startLocal={editor.startLocal}
                              endLocal={editor.endLocal}
                              myRoles={data.myRoles}
                              onClose={() => setEditor(null)}
                            />
                          )
                      : undefined
                  }
                  onSelectionDismiss={() => setEditor(null)}
                  // Only the timesheet editor's selection resizes; the crud create
                  // preview (createSel) is a static hint driven by the composer.
                  onSelectionResize={
                    editor
                      ? (startHour, endHour) =>
                          setEditor((prev) => {
                            if (!prev) return prev;
                            const day = days[prev.dayIdx];
                            if (!day) return prev;
                            return {
                              ...prev,
                              startHour,
                              endHour,
                              startLocal: dayHourToLocal(day.dateUtc, startHour),
                              endLocal: dayHourToLocal(day.dateUtc, endHour),
                            };
                          })
                      : undefined
                  }
                />
              )}
          </section>
          {layers.logged && (
            <TimesheetSummaryRail
              roleBuckets={roleBuckets}
              periodLabel={formatPayPeriod(weekPeriod, data.timezone)}
              onFocus={() => setMode("timesheet")}
            />
          )}
        </div>
      )}
      {settingsOpen && <CalendarSettingsModal data={data} onClose={() => setSettingsOpen(false)} />}
      {classesOpen && data.classesEnabled && (
        <ClassesManagerModal data={data} onClose={() => setClassesOpen(false)} />
      )}
      {composer && data.crudEnabled && (
        <EventComposer data={data} state={composer} onClose={closeComposer} onDraftChange={syncCreateSel} />
      )}
      {calMgrOpen && data.crudEnabled && (
        <CalendarManagerModal data={data} onClose={() => setCalMgrOpen(false)} />
      )}
    </div>
  );
}

function BackToCalendarBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Calendar
      </button>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  );
}

// Scheduling as an on-grid overlay: the group free/busy gradient grid on the
// left (drag to pick a slot), the meeting form docked on the right. Reuses the
// existing ScheduleWeekGrid + CreateScheduledMeetingForm — the same wiring as
// the legacy Schedule tab, re-laid-out to sit beside the grid. Week-scoped
// (scheduling happens within a week); the toolbar's week nav still applies.
function MeetingComposer({ data }: { data: LoaderData }) {
  const [searchParams] = useSearchParams();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() => {
    const projectParam = searchParams.get("project");
    if (!projectParam) return [];
    const g = data.groups.find((grp) => grp.projectId === projectParam);
    return g ? [g.id] : [];
  });
  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");

  const groupsById = new Map(data.groups.map((g) => [g.id, g]));
  const resolvedParticipantIds = (() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  })();
  const duration = durationMinutesBetween(startLocal, endLocal);

  return (
    <div className="grid min-w-0 gap-4 lg:min-h-[calc(100vh-11rem)] lg:grid-cols-[1fr_390px]">
      <div className="order-2 min-w-0 lg:order-1">
        <ScheduleWeekGrid
          participantIds={
            resolvedParticipantIds.length > 0
              ? Array.from(new Set([...resolvedParticipantIds, data.currentUserId]))
              : [data.currentUserId]
          }
          showingSelfOnly={resolvedParticipantIds.length === 0}
          users={data.users}
          workingHours={data.workingHours}
          workingHoursEnabled={data.hasPersistedWorkingHours}
          durationMinutes={duration}
          timezone={data.timezone}
          weekStartIso={data.weekStartIso}
          weekEndIso={data.weekEndIso}
          onSelectRange={(s, e) => {
            setStartLocal(s);
            setEndLocal(e);
          }}
          selectedStartLocal={startLocal}
          selectedEndLocal={endLocal}
        />
      </div>
      <aside className="order-1 min-w-0 lg:order-2">
        <CreateScheduledMeetingForm
          groups={data.groups}
          users={data.users}
          calendarLinks={data.calendarLinks}
          myProjects={data.myProjects}
          canSetSelfCheckIn={data.canSetSelfCheckIn}
          startLocal={startLocal}
          onStartLocalChange={setStartLocal}
          endLocal={endLocal}
          onEndLocalChange={setEndLocal}
          selectedUserIds={selectedUserIds}
          onChangeSelectedUserIds={setSelectedUserIds}
          selectedGroupIds={selectedGroupIds}
          onChangeSelectedGroupIds={setSelectedGroupIds}
          resolvedParticipantIds={resolvedParticipantIds}
        />
      </aside>
    </div>
  );
}

type CalendarLayerSpec = {
  key: keyof LayerVisibility;
  label: string;
  swatch: string;
};

const CALENDAR_LAYER_SPECS: CalendarLayerSpec[] = [
  { key: "workingHours", label: "Working hours", swatch: "bg-muted-foreground/40" },
  { key: "blocks", label: "My blocks", swatch: "bg-accent-coral" },
  { key: "external", label: "Linked calendars", swatch: "bg-accent-teal-light" },
  { key: "meetings", label: "Meetings", swatch: "bg-accent-teal" },
  { key: "classes", label: "Classes", swatch: "bg-[#1E5779]" },
  { key: "logged", label: "Logged time", swatch: "bg-accent-yellow" },
];

// The layer toggles, rendered inside the toolbar's "Calendars" popover. Each row
// is a colored checkbox + label; the linked-calendar colour key and the logged-
// time role-filter chips nest under their layer when it's on.
function CalendarLayerList({
  layers,
  toggleLayer,
  calendars,
  hiddenCals,
  toggleHiddenCal,
  roleBuckets,
  excludedRoleKeys,
  toggleRoleKey,
  classesEnabled,
  classCount,
  localClassCount,
  onManageClasses,
  onOpenSettings,
  crudEnabled,
  onManageCalendars,
}: {
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  calendars: { id: string; label: string; color: string | null }[];
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  roleBuckets: { key: string; label: string; hours: number }[];
  excludedRoleKeys: Set<string>;
  toggleRoleKey: (key: string) => void;
  classesEnabled: boolean;
  classCount: number;
  localClassCount: number;
  onManageClasses: () => void;
  onOpenSettings: () => void;
  crudEnabled: boolean;
  onManageCalendars: () => void;
}) {
  return (
    <>
    <ul className="flex flex-col gap-0.5">
      {CALENDAR_LAYER_SPECS.filter((s) => s.key !== "classes" || classesEnabled).map((spec) => {
        const on = layers[spec.key];
        // The navy Classes layer only carries DALI-only (Local) classes; hide its
        // toggle when there are none (Google classes ride "Linked calendars").
        const showToggle = spec.key !== "classes" || localClassCount > 0;
        return (
          <li key={spec.key}>
            {showToggle && (
              <button
                type="button"
                onClick={() => toggleLayer(spec.key)}
                aria-pressed={on}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-[4px] border transition-colors",
                    on ? cn(spec.swatch, "border-transparent") : "border-border bg-transparent",
                  )}
                >
                  {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-white/90" />}
                </span>
                <span className={cn(on ? "text-foreground" : "text-muted-foreground")}>{spec.label}</span>
              </button>
            )}
            {/* Edit-hours bridge to Settings, under Working hours */}
            {spec.key === "workingHours" && (
              <div className="mb-1 ml-8 mt-0.5">
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-xs font-medium text-accent-teal hover:underline"
                >
                  Edit hours
                </button>
              </div>
            )}
            {/* Per-calendar visibility toggles under Linked calendars */}
            {spec.key === "external" && on && calendars.length > 0 && (
              <ul className="mb-1 ml-8 mt-0.5 flex flex-col gap-0.5">
                {calendars.map((c) => {
                  const hidden = hiddenCals.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggleHiddenCal(c.id)}
                        aria-pressed={!hidden}
                        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                      >
                        <span
                          className={cn("h-2.5 w-2.5 rounded-[3px]", hidden && "opacity-30")}
                          style={{ backgroundColor: c.color ?? "var(--color-accent-coral)" }}
                        />
                        <span className={cn("truncate", hidden ? "text-muted-foreground line-through" : "text-foreground")}>
                          {c.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* No linked calendars yet → clear connect CTA */}
            {spec.key === "external" && on && calendars.length === 0 && (
              <div className="mb-1 ml-8 mt-0.5">
                <a
                  href="/oauth/calendar/google/start"
                  target="_top"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-teal hover:underline"
                >
                  ＋ Connect a calendar
                </a>
              </div>
            )}
            {/* Manage-classes entry nested under the Classes layer */}
            {spec.key === "classes" && (
              <div className={cn("mb-1 ml-8", showToggle ? "mt-0.5" : "mt-0")}>
                <button
                  type="button"
                  onClick={onManageClasses}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-teal hover:underline"
                >
                  {classCount > 0 ? `Manage classes (${classCount})` : "＋ Add your classes"}
                </button>
              </div>
            )}
            {/* Role filter chips nested under Logged time */}
            {spec.key === "logged" && on && roleBuckets.length > 0 && (
              <ul className="mb-1 ml-8 mt-1 flex flex-wrap gap-1">
                {roleBuckets.map((b) => {
                  const excluded = excludedRoleKeys.has(b.key);
                  const color = roleColor(b.key);
                  return (
                    <li key={b.key}>
                      <button
                        type="button"
                        onClick={() => toggleRoleKey(b.key)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                          excluded ? "border-border text-muted-foreground line-through" : "border-border text-foreground",
                        )}
                      >
                        <span className={cn("h-2 w-2 rounded-full", color.dot)} />
                        {b.label}
                        <span className="text-muted-foreground">{b.hours}h</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
    <div className="mt-1 border-t border-border pt-1">
      {crudEnabled && (
        <button
          type="button"
          onClick={onManageCalendars}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CalendarDays className="h-3.5 w-3.5" /> Manage calendars
        </button>
      )}
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Settings className="h-3.5 w-3.5" /> Calendar settings
      </button>
    </div>
    </>
  );
}

// Calendar settings (integrations, working hours, buffers, manual blocks) as a
// centered modal opened from the toolbar gear — off the main canvas so the grid
// keeps the full width.
function CalendarSettingsModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close settings" onClick={onClose} tabIndex={-1} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Calendar settings"
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-brand-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">Calendar settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Behavior only — connecting accounts lives in global Settings, and
            calendars (show/hide, create/rename/delete) live in the Calendars
            menu, so they're not duplicated here. */}
        <div className="flex flex-col gap-6">
          {data.generalCalendar === "missing" && data.calendarLinks.length > 0 && (
            <GeneralCalendarPrompt links={data.calendarLinks} />
          )}
          <WorkingHoursCard workingHours={data.workingHours} hasPersisted={data.hasPersistedWorkingHours} />
          <EventBuffersCard bufferMin={data.defaultEventBufferMin} />
        </div>
      </div>
    </div>
  );
}


const padTwo = (n: number) => String(n).padStart(2, "0");
const minToHHMM = (m: number) => `${padTwo(Math.floor(m / 60))}:${padTwo(m % 60)}`;
const CUSTOM_WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
];

// The same calendar the class currently writes to, as a destination value — so
// editing a class doesn't silently move it. Dedicated/primary/sub-calendar all
// collapse to their concrete calendarId here, which is what matters.
function currentDestinationValue(c: MemberClassDTO): string {
  if (c.storage === "Local" || !c.linkId) return "local";
  if (!c.calendarId || c.calendarId === "primary") return `google:${c.linkId}:primary`;
  return `google:${c.linkId}:cal:${c.calendarId}`;
}

// "My classes this term" — add Dartmouth classes (period picker or custom time)
// to the calendar, synced to a linked Google calendar or kept as a DALI layer.
function ClassesManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const removeFetcher = useFetcher();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState(""); // "" | period code | "custom"
  const [includeXHour, setIncludeXHour] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [location, setLocation] = useState("");
  const [destination, setDestination] = useState(() => {
    // Default to the first Google destination (classes "live in the linked
    // calendars"); fall back to Local when no account is connected.
    const preferred = data.classDestinations.find((d) => d.kind !== "local") ?? data.classDestinations[0];
    return preferred ? destinationValue(preferred) : "local";
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setMode("");
    setIncludeXHour(false);
    setCustomDays([]);
    setCustomStart("");
    setCustomEnd("");
    setLocation("");
  }

  // Clear the form after a successful add/edit (settled, no error).
  const prevState = useRef(fetcher.state);
  useEffect(() => {
    if (prevState.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) resetForm();
    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  function startEdit(c: MemberClassDTO) {
    setEditingId(c.id);
    setTitle(c.title);
    setLocation(c.location ?? "");
    setDestination(currentDestinationValue(c));
    if (c.periodCode) {
      setMode(c.periodCode);
      setIncludeXHour(c.meetings.some((m) => m.kind === "xhour"));
    } else {
      setMode("custom");
      const main = c.meetings.find((m) => m.kind === "main");
      setCustomDays(main?.days ?? []);
      setCustomStart(main ? minToHHMM(main.startMin) : "");
      setCustomEnd(main ? minToHHMM(main.endMin) : "");
    }
  }

  const isPeriod = mode !== "" && mode !== "custom";
  const period = isPeriod ? getPeriod(mode) : undefined;
  const submitting = fetcher.state !== "idle";
  const canSubmit =
    title.trim() !== "" &&
    (isPeriod || (mode === "custom" && customDays.length > 0 && customStart !== "" && customEnd !== ""));

  const periodOptions = [
    { value: "", label: "Choose a class period…" },
    ...DARTMOUTH_PERIODS.map((p) => ({ value: p.code, label: periodSummary(p) })),
    { value: "custom", label: "Custom day & time…" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close classes" onClick={onClose} tabIndex={-1} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Classes this term"
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-brand-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Classes{data.classTerm ? ` · ${data.classTerm.code}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!data.classTerm ? (
          <p className="text-sm text-muted-foreground">There's no active term to add classes to yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Existing classes */}
            {data.memberClasses.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {data.memberClasses.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: "#1E5779" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {c.title}
                        {c.periodCode && <span className="ml-1.5 text-xs text-muted-foreground">{c.periodCode}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {classScheduleSummary(c.meetings)} · {c.destinationLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Edit ${c.title}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingId === c.id) resetForm();
                        removeFetcher.submit({ intent: "class-remove", classId: c.id }, { method: "post" });
                      }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                      aria-label={`Remove ${c.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add / edit form */}
            <fetcher.Form method="post" className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <input type="hidden" name="intent" value={editingId ? "class-update" : "class-add"} />
              {editingId && <input type="hidden" name="classId" value={editingId} />}
              <input type="hidden" name="periodCode" value={isPeriod ? mode : ""} />
              <input type="hidden" name="includeXHour" value={isPeriod && includeXHour && period?.xhour ? "1" : ""} />
              <input type="hidden" name="customDays" value={mode === "custom" ? customDays.join(",") : ""} />
              <input type="hidden" name="destination" value={destination} />

              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {editingId ? "Edit class" : "Add a class"}
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Class</span>
                <input
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. CS 52 — Full-Stack Web Dev"
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">When</span>
                <Select
                  value={mode}
                  onChange={setMode}
                  options={periodOptions}
                  placeholder="Choose a class period…"
                  buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                />
              </label>

              {isPeriod && period && (
                <>
                  <p className="text-xs text-muted-foreground">{periodSummary(period)}</p>
                  {period.xhour && (
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={includeXHour} onChange={() => setIncludeXHour((v) => !v)} />
                      Include the x-hour
                    </label>
                  )}
                </>
              )}

              {mode === "custom" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {CUSTOM_WEEKDAYS.map((d) => {
                      const on = customDays.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          onClick={() =>
                            setCustomDays((prev) => (on ? prev.filter((x) => x !== d.n) : [...prev, d.n]))
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            on ? "border-transparent bg-accent-teal text-white" : "border-border text-muted-foreground",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="time"
                      name="customStart"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="time"
                      name="customEnd"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1"
                    />
                  </div>
                </div>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Location (optional)</span>
                <input
                  name="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. ECSC 008"
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Add to</span>
                <Select
                  value={destination}
                  onChange={setDestination}
                  options={data.classDestinations.map((d) => ({ value: destinationValue(d), label: d.label }))}
                  placeholder="Where should classes go?"
                  buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                />
              </label>

              {fetcher.data?.error && <p className="text-xs text-red-600">{fetcher.data.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit || submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral-light disabled:opacity-50"
                >
                  {editingId ? "Save class" : "Add class"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </fetcher.Form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Event composer (calendar-google-crud) ─────────────────────────────────
// Create / edit / delete a Google Calendar event. Recurrence-create is deferred
// (single events for now); editing patches this event/occurrence's fields.

const dtPad = (n: number) => String(n).padStart(2, "0");
function isoToLocalDT(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${dtPad(d.getMonth() + 1)}-${dtPad(d.getDate())}T${dtPad(d.getHours())}:${dtPad(d.getMinutes())}`;
}
function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10); // all-day = UTC-midnight date
}
function addDaysToDate(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/New_York";
  }
}

export const LOCAL_DEST = "local";

/** Where a new event can go: the in-app DALI calendar, or any writable Google
 *  calendar. "In app vs Google" is just a destination — not a different thing. */
function eventDestinations(data: LoaderData): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: LOCAL_DEST, label: "DALI calendar (in app)" }];
  for (const link of data.calendarLinks) {
    if (link.provider !== "Google" || !link.subCalendars) continue;
    const account = link.displayName || link.externalEmail || "Google";
    for (const sub of link.subCalendars) {
      if (!sub.writable) continue;
      out.push({ value: `${link.id}:${sub.id}`, label: `${account} · ${sub.primary ? "Primary" : sub.summary}` });
    }
  }
  return out;
}

/** A floating card anchored next to an on-screen rect (a clicked event, a
 *  dragged slot, or the New button), Google-Calendar style — prefers the
 *  anchor's right side, flips left / shifts up to stay on-screen, and centers
 *  near the top when no anchor is given. Dismisses on Escape and on an outside
 *  mousedown; clicks inside the card or inside a floating dropdown portal (the
 *  card's own Selects / RepeatField) are not treated as outside. No dark
 *  backdrop — it's a popover, not a full-screen modal. */
function AnchoredPopover({
  anchor,
  onClose,
  ariaLabel,
  className,
  draggable = false,
  children,
}: {
  anchor?: DOMRect | null;
  onClose: () => void;
  ariaLabel?: string;
  className?: string;
  // When true, mousedown on a [data-drag-handle] region (minus its buttons)
  // moves the card freely, overriding the anchored position until it closes.
  draggable?: boolean;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Free position once the user drags the card by its handle; overrides `pos`.
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    if (!draggable || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-drag-handle]")) return;
    if (target.closest("button,a,input,select,textarea")) return; // let the X (etc.) work
    const card = cardRef.current;
    if (!card) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (mev: MouseEvent) => {
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const left = Math.max(8, Math.min(mev.clientX - offX, window.innerWidth - cw - 8));
      const top = Math.max(8, Math.min(mev.clientY - offY, window.innerHeight - ch - 8));
      setDragPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      // The card's own dropdowns render into a portal at <body>, so they're not
      // inside cardRef — a click there isn't an outside click. Covers the Select
      // / RepeatField floating layers and the DateField / TimeField calendar
      // popovers (both role="dialog").
      const el = target instanceof Element ? target : (target.parentElement as Element | null);
      if (el?.closest("[data-floating-ui-portal],[data-calendar-popover],[role='dialog']")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    };
  }, [onClose]);

  // A fresh anchor means a fresh open — drop any leftover drag position.
  useLayoutEffect(() => setDragPos(null), [anchor]);

  useLayoutEffect(() => {
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const gap = 8;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const a =
        anchor ??
        ({ left: vw / 2 - cw / 2, right: vw / 2 + cw / 2, top: 72, bottom: 72 } as DOMRect);
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw; // flip to the left side
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      let top = a.top;
      if (top + ch + margin > vh) top = vh - ch - margin; // shift up to fit
      top = Math.max(margin, top);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  if (typeof document === "undefined") return null;

  const shown = dragPos ?? pos;
  return createPortal(
    <div
      ref={cardRef}
      data-calendar-popover
      role="dialog"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        e.stopPropagation();
        startDrag(e);
      }}
      className={cn("fixed z-50", className)}
      style={{ left: shown?.left ?? 0, top: shown?.top ?? 0, visibility: shown ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

type ComposerState =
  // anchor is the on-screen rect of the clicked event / dragged slot / New
  // button, so the composer pops up next to it (Google-Calendar style) rather
  // than as a centered full-screen modal. Null → centered fallback. seed
  // prefills a create from an existing event (Duplicate) — its identity fields
  // (eventId/manualBlockId) are ignored, so it saves as a brand-new event.
  | { mode: "create"; startLocal?: string; endLocal?: string; anchor?: DOMRect | null; seed?: ExternalEventDTO }
  | { mode: "edit"; event: ExternalEventDTO; anchor?: DOMRect | null };

function EventComposer({
  data,
  state,
  onClose,
  onDraftChange,
}: {
  data: LoaderData;
  state: ComposerState;
  onClose: () => void;
  // Reports the draft's current start/end while creating, so the grid can draw
  // a tentative block that tracks the edits.
  onDraftChange?: (startIso: string, endIso: string, allDay: boolean) => void;
}) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const deleteFetcher = useFetcher<{ error?: string } | null>();
  const editing = state.mode === "edit";
  const ev = editing ? state.event : null;
  // Prefill source: the event being edited, or a Duplicate seed in create mode.
  // Identity (eventId/manualBlockId/recurringEventId) stays on `ev` so a
  // duplicate saves as a brand-new event; `base` only drives the field values.
  const base = ev ?? (state.mode === "create" ? state.seed ?? null : null);
  const dests = eventDestinations(data);

  const [title, setTitle] = useState(base?.title ?? "");
  const [allDay, setAllDay] = useState(base?.allDay ?? false);
  const [destination, setDestination] = useState(() => {
    if (base?.manualBlockId) return LOCAL_DEST; // in-app block
    if (base?.linkId && base.calendarId) return `${base.linkId}:${base.calendarId}`;
    // Default to the last-used destination (cookie); else the first Google
    // calendar; else the in-app DALI calendar.
    if (data.defaultEventDest && dests.some((d) => d.value === data.defaultEventDest)) return data.defaultEventDest;
    return dests.find((d) => d.value !== LOCAL_DEST)?.value ?? LOCAL_DEST;
  });
  const [location, setLocation] = useState(base?.location ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  // A recurring instance carries recurringEventId; editing it prompts for scope.
  const isRecurring = Boolean(ev?.recurringEventId);
  const [scope, setScope] = useState<"this" | "following" | "all">("this");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // In-app (DALI) blocks can log to the timesheet — the one property that only
  // makes sense for the local destination.
  const isLocal = destination === LOCAL_DEST;
  const [isWork, setIsWork] = useState(base?.isWork ?? false);
  const [roleKey, setRoleKey] = useState(
    base?.assignmentType && base?.roleRefId ? `${base.assignmentType}::${base.roleRefId}` : "",
  );
  // The timesheet entry's own description — required when logging, kept separate
  // from the event description above.
  const [workNote, setWorkNote] = useState(base?.workNote ?? "");

  // Timed inputs are split into one date + start/end times (custom DateField /
  // TimeField). Seeded from the event/seed or the drag — the seed strings are
  // "yyyy-MM-ddThh:mm", so date = [0..10] and time = [11..16].
  const seedTimed = base && !base.allDay ? { s: isoToLocalDT(base.startIso), e: isoToLocalDT(base.endIso) } : null;
  const createSeed = state.mode === "create" ? { s: state.startLocal, e: state.endLocal } : null;
  const initStartDT = seedTimed?.s ?? createSeed?.s ?? "";
  const initEndDT = seedTimed?.e ?? createSeed?.e ?? "";
  const [date, setDate] = useState(initStartDT.slice(0, 10));
  const [startTime, setStartTime] = useState(initStartDT.slice(11, 16));
  const [endTime, setEndTime] = useState(initEndDT.slice(11, 16));
  const [dStart, setDStart] = useState(
    base?.allDay ? isoToDateInput(base.startIso) : initStartDT.slice(0, 10),
  );
  const [dEnd, setDEnd] = useState(
    base?.allDay ? addDaysToDate(isoToDateInput(base.endIso), -1) : initEndDT.slice(0, 10),
  );

  // Close on a successful create/edit/delete.
  const prev = useRef(fetcher.state);
  useEffect(() => {
    if (prev.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) onClose();
    prev.current = fetcher.state;
  }, [fetcher.state, fetcher.data, onClose]);
  const prevDel = useRef(deleteFetcher.state);
  useEffect(() => {
    if (prevDel.current !== "idle" && deleteFetcher.state === "idle" && !deleteFetcher.data?.error) onClose();
    prevDel.current = deleteFetcher.state;
  }, [deleteFetcher.state, deleteFetcher.data, onClose]);

  // Derived hidden values. Timed events use one date + start/end times; an end
  // that's earlier than the start is read as crossing midnight (next day).
  const startLocalDT = date && startTime ? `${date}T${startTime}` : "";
  const endDate = date && startTime && endTime && endTime < startTime ? addDaysToDate(date, 1) : date;
  const endLocalDT = endDate && endTime ? `${endDate}T${endTime}` : "";
  const startIso = allDay
    ? dStart
      ? `${dStart}T00:00:00.000Z`
      : ""
    : startLocalDT
      ? new Date(startLocalDT).toISOString()
      : "";
  const endIso = allDay
    ? dEnd
      ? `${addDaysToDate(dEnd, 1)}T00:00:00.000Z` // Google end is exclusive
      : ""
    : endLocalDT
      ? new Date(endLocalDT).toISOString()
      : "";
  const canSubmit =
    title.trim() !== "" &&
    destination !== "" &&
    startIso !== "" &&
    endIso !== "" &&
    startIso < endIso &&
    (!(isLocal && isWork) || (roleKey !== "" && workNote.trim() !== ""));
  const submitting = fetcher.state !== "idle" || deleteFetcher.state !== "idle";

  // Keep the grid's tentative create block in sync with the times as they change.
  useEffect(() => {
    if (state.mode !== "create") return;
    onDraftChange?.(startIso, endIso, allDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, endIso, allDay]);

  const rememberDest = () => {
    try {
      document.cookie = `dali_event_dest=${encodeURIComponent(destination)}; path=/; max-age=31536000`;
    } catch {
      /* ignore */
    }
  };

  const fieldCls = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

  return (
    <AnchoredPopover
      anchor={state.anchor}
      onClose={onClose}
      draggable
      ariaLabel={editing ? "Edit event" : "New event"}
      className="w-[23rem] max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card shadow-brand-3"
    >
        {/* Header — doubles as the drag handle (grab anywhere but the close X).
            Sticky + opaque so it stays grabbable if the form scrolls. */}
        <div
          data-drag-handle
          className="sticky top-0 z-10 flex cursor-move select-none items-center justify-between rounded-t-xl border-b border-border bg-muted px-4 py-2.5"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            <h2 className="font-heading text-sm font-semibold text-foreground">{editing ? "Edit event" : "New event"}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {dests.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            Connect a Google Calendar you can write to first (Settings → Calendar).
          </p>
        ) : (
          <fetcher.Form method="post" onSubmit={rememberDest} className="flex flex-col gap-3 px-4 py-4">
            <input type="hidden" name="intent" value={editing ? "event-update" : "event-create"} />
            {editing && ev?.eventId && <input type="hidden" name="eventId" value={ev.eventId} />}
            {editing && ev?.manualBlockId && <input type="hidden" name="manualBlockId" value={ev.manualBlockId} />}
            <input type="hidden" name="destination" value={destination} />
            <input type="hidden" name="startIso" value={startIso} />
            <input type="hidden" name="endIso" value={endIso} />
            <input type="hidden" name="allDay" value={allDay ? "1" : ""} />
            <input type="hidden" name="timeZone" value={browserTz()} />
            <input type="hidden" name="recurrenceRule" value={!isRecurring ? (repeatSpecToRRule(repeat) ?? "") : ""} />
            <input type="hidden" name="isWork" value={isLocal && isWork ? "1" : ""} />
            <input type="hidden" name="assignmentType" value={isLocal && isWork ? roleKey.split("::")[0] ?? "" : ""} />
            <input type="hidden" name="roleRefId" value={isLocal && isWork ? roleKey.split("::")[1] ?? "" : ""} />
            <input type="hidden" name="workNote" value={isLocal && isWork ? workNote : ""} />
            {isRecurring && <input type="hidden" name="scope" value={scope} />}
            {isRecurring && ev?.recurringEventId && (
              <input type="hidden" name="recurringEventId" value={ev.recurringEventId} />
            )}
            {isRecurring && ev?.startIso && <input type="hidden" name="originalStartIso" value={ev.startIso} />}

            {/* Title */}
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              className="rounded-md border border-border bg-background px-3 py-2 text-base font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-accent-coral focus:outline-none"
              autoFocus
            />

            {/* When — all-day toggle + start/end */}
            <div className="flex items-start gap-3">
              <Clock className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={allDay} onChange={() => setAllDay((v) => !v)} /> All day
                </label>
                {allDay ? (
                  <div className="flex items-center gap-2 text-sm">
                    <DateField mode="date" value={dStart} onChange={setDStart} ariaLabel="Start date" className="min-w-0 flex-1" />
                    <span className="text-muted-foreground">to</span>
                    <DateField mode="date" value={dEnd} onChange={setDEnd} ariaLabel="End date" className="min-w-0 flex-1" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 text-sm">
                    <DateField mode="date" value={date} onChange={setDate} ariaLabel="Date" className="w-full" />
                    <div className="flex items-center gap-2">
                      <TimeComboField value={startTime} onChange={setStartTime} ariaLabel="Start time" className="min-w-0 flex-1" />
                      <span className="text-muted-foreground">–</span>
                      <TimeComboField value={endTime} onChange={setEndTime} ariaLabel="End time" className="min-w-0 flex-1" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Calendar destination */}
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {editing ? (
                  <span className={cn(fieldCls, "block text-muted-foreground")}>
                    {dests.find((d) => d.value === destination)?.label ?? "This calendar"}
                  </span>
                ) : (
                  <Select
                    value={destination}
                    onChange={setDestination}
                    options={dests}
                    placeholder="Pick a calendar"
                    buttonClassName={cn(fieldCls, "w-full inline-flex items-center justify-between gap-1 text-left hover:bg-muted/40")}
                  />
                )}
              </div>
            </div>

            {/* Timesheet logging is the one thing unique to the in-app destination —
                nested under Calendar with an empty icon gutter to keep alignment.
                When on, the block mirrors into a linked timesheet entry with its
                own role + description (kept separate from the event above). */}
            {isLocal && data.myRoles.length > 0 && repeatSpecToRRule(repeat) === null && (
              <div className="flex items-start gap-3">
                <div className="w-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={isWork} onChange={() => setIsWork((v) => !v)} /> Add to timesheet
                  </label>
                  {isWork && (
                    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Clock className="h-3 w-3" /> Linked timesheet entry
                      </div>
                      <Select
                        value={roleKey}
                        onChange={setRoleKey}
                        options={data.myRoles.map((r) => ({ value: `${r.assignmentType}::${r.roleRefId}`, label: r.label }))}
                        placeholder="Which role?"
                        buttonClassName={cn(fieldCls, "w-full inline-flex items-center justify-between gap-1 text-left hover:bg-muted/40")}
                      />
                      <textarea
                        value={workNote}
                        onChange={(e) => setWorkNote(e.target.value)}
                        placeholder="What did you work on?"
                        rows={2}
                        aria-label="Timesheet description"
                        className={cn(fieldCls, "w-full resize-y")}
                      />
                      {workNote.trim() === "" && (
                        <p className="text-[11px] text-muted-foreground">
                          A timesheet description is required — it's logged separately from the event.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="my-0.5 border-t border-border/60" />

            {/* Location */}
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                name="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location"
                className={cn(fieldCls, "min-w-0 flex-1")}
              />
            </div>

            {/* Description */}
            <div className="flex items-start gap-3">
              <AlignLeft className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description"
                rows={2}
                className={cn(fieldCls, "min-w-0 flex-1 resize-y")}
              />
            </div>

            {/* Repeat */}
            {isRecurring ? (
              <div className="flex items-start gap-3">
                <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Repeating event — apply to</span>
                  <div className="inline-flex w-fit rounded-md border border-border p-0.5 text-xs">
                    {(["this", "following", "all"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setScope(s)}
                        className={cn(
                          "rounded px-2 py-1",
                          scope === s ? "bg-accent-coral text-white" : "text-foreground hover:bg-muted",
                        )}
                      >
                        {s === "this" ? "This event" : s === "following" ? "This & following" : "All events"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : !editing ? (
              <div className="flex items-center gap-3">
                <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <RepeatField
                    value={repeat}
                    onChange={setRepeat}
                    anchorLocal={allDay ? dStart : startLocalDT}
                    labelClassName="sr-only"
                    fieldClassName={cn(fieldCls, "w-full")}
                  />
                </div>
              </div>
            ) : null}

            {(fetcher.data?.error || deleteFetcher.data?.error) && (
              <p className="text-xs text-red-600">{fetcher.data?.error || deleteFetcher.data?.error}</p>
            )}
            {editing && !ev?.writable && (
              <p className="text-xs text-muted-foreground">This event is read-only.</p>
            )}

            <div className="mt-1 flex items-center gap-2 border-t border-border pt-3">
              <button
                type="submit"
                disabled={!canSubmit || submitting || (editing && !ev?.writable)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral-light disabled:opacity-50"
              >
                {editing ? "Save" : "Create event"}
              </button>
              {editing && ev?.writable && (ev.eventId || ev.manualBlockId) && (
                <div className="ml-auto">
                  {confirmDelete ? (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        deleteFetcher.submit(
                          {
                            intent: "event-delete",
                            destination,
                            eventId: ev.eventId ?? "",
                            manualBlockId: ev.manualBlockId ?? "",
                            scope: isRecurring ? scope : "this",
                            recurringEventId: ev.recurringEventId ?? "",
                            originalStartIso: ev.startIso ?? "",
                          },
                          { method: "post" },
                        )
                      }
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </fetcher.Form>
        )}
    </AnchoredPopover>
  );
}

// ── Calendar management (calendar-google-crud, P4) ─────────────────────────
// Create / rename / delete Google calendars on a linked account.
function CalendarManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const [newName, setNewName] = useState("");
  const googleLinks = data.calendarLinks.filter((l) => l.provider === "Google" && l.subCalendars);
  const [newLink, setNewLink] = useState(googleLinks[0]?.id ?? "");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const prev = useRef(fetcher.state);
  useEffect(() => {
    if (prev.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) {
      setNewName("");
      setRenaming(null);
      setConfirmDel(null);
    }
    prev.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  const fieldCls = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-label="Manage calendars" className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-brand-3">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">Manage calendars</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {googleLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect a Google account first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {googleLinks.map((link) => (
              <div key={link.id} className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {link.displayName || link.externalEmail}
                </div>
                {(link.subCalendars ?? []).map((cal) => (
                  <div key={cal.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5">
                    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: cal.color ?? "#9ca3af" }} />
                    {renaming === cal.id ? (
                      <fetcher.Form method="post" className="flex flex-1 items-center gap-1">
                        <input type="hidden" name="intent" value="cal-rename" />
                        <input type="hidden" name="linkId" value={link.id} />
                        <input type="hidden" name="calendarId" value={cal.id} />
                        <input name="summary" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} className={cn(fieldCls, "flex-1")} autoFocus />
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Save</button>
                      </fetcher.Form>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {cal.summary}
                        {cal.primary && <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">Primary</span>}
                        {!cal.writable && <span className="ml-1.5 text-[10px] text-muted-foreground">read-only</span>}
                      </span>
                    )}
                    {cal.writable && renaming !== cal.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRenaming(cal.id);
                            setRenameVal(cal.summary);
                          }}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Rename ${cal.summary}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!cal.primary &&
                          (confirmDel === cal.id ? (
                            <button
                              type="button"
                              onClick={() =>
                                fetcher.submit({ intent: "cal-delete", linkId: link.id, calendarId: cal.id }, { method: "post" })
                              }
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDel(cal.id)}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                              aria-label={`Delete ${cal.summary}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}

            <fetcher.Form method="post" className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <input type="hidden" name="intent" value="cal-create" />
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New calendar</div>
              <input name="summary" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Calendar name" className={fieldCls} />
              {googleLinks.length > 1 && (
                <Select
                  value={newLink}
                  onChange={setNewLink}
                  options={googleLinks.map((l) => ({ value: l.id, label: l.displayName || l.externalEmail }))}
                  buttonClassName={cn(fieldCls, "w-full inline-flex items-center justify-between gap-1 text-left hover:bg-muted/40")}
                />
              )}
              <input type="hidden" name="linkId" value={newLink} />
              {fetcher.data?.error && <p className="text-xs text-red-600">{fetcher.data.error}</p>}
              <button
                type="submit"
                disabled={newName.trim() === "" || newLink === "" || fetcher.state !== "idle"}
                className="w-fit rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral-light disabled:opacity-50"
              >
                Create calendar
              </button>
            </fetcher.Form>
          </div>
        )}
      </div>
    </div>
  );
}

function TimesheetSummaryRail({
  roleBuckets,
  periodLabel,
  onFocus,
}: {
  roleBuckets: { key: string; label: string; hours: number }[];
  periodLabel: string;
  onFocus: () => void;
}) {
  const total = roleBuckets.reduce((sum, b) => sum + b.hours, 0);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        Logged time · pay period <span className="font-medium text-foreground">{periodLabel}</span>
      </span>
      <span className="font-semibold text-foreground">{Math.round(total * 10) / 10}h</span>
      {roleBuckets.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {roleBuckets.map((b, i) => (
            <span key={b.key}>
              {i > 0 && " · "}
              {b.label} {Math.round(b.hours * 10) / 10}h
            </span>
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={onFocus}
        className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
      >
        Focus
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Availability view                                                   */
/* ------------------------------------------------------------------ */

function AvailabilityView({ data }: { data: LoaderData }) {
  // Fill the available iframe viewport (minus tab bar + page padding) so the
  // grid extends to the screen edge. Floor at 56rem so the grid never gets
  // clipped by the inner overflow-hidden on short viewports.
  // Drag-to-create now lives inside AvailabilityWeekGrid: the selection stays
  // drawn on the grid and the editor opens as a popover anchored beside it.
  //
  // Collapse state is a deliberate user preference ("I want more grid room"),
  // so it lives in localStorage and sticks across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(AVAILABILITY_SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        AVAILABILITY_SIDEBAR_COLLAPSED_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // localStorage disabled / quota — ignore
    }
  }, [sidebarCollapsed]);
  const { os, iconBtn } = useOsChrome();
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6 lg:h-[max(calc(100vh-9rem),56rem)] lg:min-h-0",
        os ? "pt-1" : "px-3 pt-2",
        sidebarCollapsed ? "lg:grid-cols-[3rem_1fr]" : "lg:grid-cols-[400px_1fr]",
      )}
    >
      {sidebarCollapsed ? (
        <Tooltip content="Expand settings">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className={cn(
              "hidden lg:flex lg:flex-col lg:items-center lg:min-h-0 py-3",
              os
                ? "rounded-os-item bg-os-card text-os-grey transition-colors hover:bg-os-card-hover hover:text-foreground"
                : "rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-label="Expand availability settings"
          >
            <PanelLeftOpen className="h-5 w-5 shrink-0" />
          </button>
        </Tooltip>
      ) : (
        <aside
          className={cn(
            "flex flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:min-h-0",
            os ? "gap-8 lg:pr-8" : "gap-6 lg:pr-6",
          )}
        >
          {/* Under os the page carries its own "Calendar" title and the
              switcher already says which view this is, so the rail drops the
              heading and keeps only the collapse control. */}
          <header
            className={cn(
              "flex items-start gap-2",
              os ? "justify-end" : "justify-between",
            )}
          >
            {!os && (
              <div>
                <h1 className="font-heading text-2xl font-bold text-foreground">Availability</h1>
              </div>
            )}
            <Tooltip content="Collapse settings">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className={cn(
                  "hidden lg:inline-flex shrink-0",
                  os
                    ? iconBtn
                    : "rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-label="Collapse availability settings"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </Tooltip>
          </header>
          <CalendarIntegrationsCard
            links={data.calendarLinks}
            ingestionError={data.ingestionError}
            generalCalendar={data.generalCalendar}
          />
          <WorkingHoursCard
            workingHours={data.workingHours}
            hasPersisted={data.hasPersistedWorkingHours}
          />
          <EventBuffersCard bufferMin={data.defaultEventBufferMin} />
          <ManualBlocksCard blocks={data.manualBlocks} timezone={data.timezone} />
        </aside>
      )}
      <div className="lg:flex lg:flex-col lg:overflow-hidden lg:min-h-0">
        <AvailabilityWeekGrid data={data} enableDragCreate />
      </div>
    </div>
  );
}

function CalendarIntegrationsCard({
  links,
  ingestionError,
  generalCalendar,
}: {
  links: CalendarLinkDTO[];
  ingestionError: string | null;
  generalCalendar: GeneralCalendarState;
}) {
  const { os, card, cardPad, bodyText, heading, headingIcon, quietBtn } = useOsChrome();
  return (
    <section>
      <div className={cn("flex items-center justify-between", os ? "mb-4" : "mb-3")}>
        <h2 className={heading}>
          <CalendarDays className={headingIcon} />
          Calendar Integrations
        </h2>
        {/* `<a target="_top">` — Google's auth page sends X-Frame-Options: DENY, so
            it can't render inside the workspace iframe. Break out to the top window. */}
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className={quietBtn}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Google Account
        </a>
      </div>
      {ingestionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-2">
          Couldn't refresh external events: {ingestionError}
        </div>
      )}
      {generalCalendar === "missing" && <GeneralCalendarPrompt links={links} />}
      {links.length > 0 && (
        <p className={cn(bodyText, "mb-3 text-xs")}>
          These control which calendars <strong>feed into DALI</strong> — their events and your
          availability. To just hide a calendar on the grid, use <strong>Calendars ▾</strong> on the
          calendar.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {links.length === 0 && (
          <div className={cn(card, cardPad, bodyText)}>No external calendars connected.</div>
        )}
        {links.map((l) => (
          <CalendarLinkBlock key={l.id} link={l} />
        ))}
      </div>
    </section>
  );
}

// Shown while the shared DALI General Calendar isn't on any linked Google
// account. One account → subscribe straight away; several → let the member pick
// which one it lands on.
function GeneralCalendarPrompt({ links }: { links: CalendarLinkDTO[] }) {
  const { os } = useOsChrome();
  const fetcher = useFetcher<{ error?: string }>();
  const [picking, setPicking] = useState(false);
  const accounts = links.filter((l) => l.provider === "Google");
  if (accounts.length === 0) return null;

  const subscribe = (linkId: string) =>
    fetcher.submit({ intent: "subscribe-general-calendar", linkId }, { method: "post" });
  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  return (
    <div
      className={cn(
        "bg-accent-coral/10 border border-accent-coral/30 px-3 py-2.5 mb-2 flex flex-col gap-2",
        os ? "rounded-os-item" : "rounded-md",
      )}
    >
      <p className="text-xs text-foreground">Add the DALI General Calendar</p>
      {picking && accounts.length > 1 ? (
        <div className="flex flex-col gap-1">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy}
              onClick={() => subscribe(a.id)}
              className={cn(
                "flex items-center gap-2 border border-border bg-card px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-60",
                os ? "rounded-os-item" : "rounded-md",
              )}
            >
              <GoogleIcon />
              <span className="truncate">{a.externalEmail}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (accounts.length === 1 ? subscribe(accounts[0].id) : setPicking(true))}
          className={cn(
            "self-start inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-accent-coral text-white hover:bg-accent-coral-light transition-colors disabled:opacity-60",
            os ? "rounded-full" : "rounded-md",
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          {busy
            ? "Adding…"
            : accounts.length === 1
              ? `Add to ${accounts[0].externalEmail}`
              : "Add DALI calendar"}
        </button>
      )}
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const { os, card, bodyText } = useOsChrome();
  const removeFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "overflow-hidden",
        card,
        // The teal edge is the brand shell's source marker; under os the tinted
        // header carries that on its own and a 4px edge fights the 24px corner.
        !os && "border-l-4 border-l-accent-teal",
      )}
    >
      <div className="flex items-center justify-between bg-accent-teal/10 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          <Chevron className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <GoogleIcon />
          <span className="font-semibold text-sm text-foreground truncate">
            {link.displayName ?? link.externalEmail}
          </span>
          {!open && link.syncError && (
            <span className="flex-shrink-0 text-[11px] text-destructive">Sync error</span>
          )}
        </button>
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Remove ${link.externalEmail}`}
            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </removeFetcher.Form>
      </div>
      {open && (
        <div id={bodyId} className="px-3 py-3 flex flex-col gap-2">
          {link.syncError && (
            <div className="text-[11px] text-destructive">Sync error: {link.syncError}</div>
          )}
          {link.subCalendars === null ? (
            <div className={cn(bodyText, "italic")}>Couldn't load this account's calendars.</div>
          ) : link.subCalendars.length === 0 ? (
            <div className={cn(bodyText, "italic")}>No calendars found.</div>
          ) : (
            link.subCalendars.map((cal) => (
              <SubCalendarRow key={cal.id} linkId={link.id} cal={cal} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function SubCalendarRow({ linkId, cal }: { linkId: string; cal: SubCalendarDTO }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const enabled = pending ? pending.get("enabled") === "true" : cal.enabled;
  return (
    <button
      type="button"
      onClick={() =>
        fetcher.submit(
          {
            intent: "toggle-sub-calendar",
            linkId,
            calendarId: cal.id,
            enabled: String(!enabled),
          },
          { method: "post" },
        )
      }
      className="flex items-center justify-between text-left hover:bg-muted/50 rounded-md px-1 py-1 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: cal.color ?? "var(--accent-coral)" }}
        />
        <span className="text-sm text-foreground truncate">{cal.summary}</span>
        {cal.primary && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Primary
          </span>
        )}
      </div>
      <span
        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled
            ? "bg-accent-coral border-accent-coral text-white"
            : "border-border bg-background"
        }`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function WorkingHoursCard({
  workingHours,
  hasPersisted,
}: {
  workingHours: WhDay[];
  hasPersisted: boolean;
}) {
  const { os, card, cardPad, heading, headingIcon, iconBtn } = useOsChrome();
  const resetFetcher = useFetcher();
  const toggleFetcher = useFetcher();

  // "On" once the user has saved any working-hours state. While a master-toggle
  // submit is in flight, reflect the in-flight intent optimistically.
  const pendingToggleIntent =
    typeof toggleFetcher.formData?.get("intent") === "string"
      ? (toggleFetcher.formData.get("intent") as string)
      : null;
  const enabled =
    pendingToggleIntent === "seed-working-hours"
      ? true
      : pendingToggleIntent === "reset-working-hours"
        ? false
        : hasPersisted;

  const turnOn = () => {
    // Persist the full Mon–Fri 9–5 default in one shot so the editor opens with
    // sensible values and every day has a real row.
    const days = defaultWorkingHours().map((d) => ({
      dayOfWeek: d.dayOfWeek,
      segments: d.segments.map((s) => ({
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        location: s.location,
      })),
    }));
    toggleFetcher.submit(
      { intent: "seed-working-hours", days: JSON.stringify(days) },
      { method: "post" },
    );
  };
  const turnOff = () =>
    toggleFetcher.submit({ intent: "reset-working-hours" }, { method: "post" });

  return (
    <section>
      <div className={cn("flex items-center justify-between", os ? "mb-4" : "mb-3")}>
        <h2 className={heading}>
          <Clock className={headingIcon} />
          Working Hours
        </h2>
        <div className="flex items-center gap-1">
          {enabled && (
            <>
              <resetFetcher.Form
                method="post"
                onSubmit={(e) => {
                  // Re-seed the default week rather than wiping to "off" — this
                  // button resets hours, it doesn't disable the feature.
                  e.preventDefault();
                  const days = defaultWorkingHours().map((d) => ({
                    dayOfWeek: d.dayOfWeek,
                    segments: d.segments.map((s) => ({
                      startMinute: s.startMinute,
                      endMinute: s.endMinute,
                      location: s.location,
                    })),
                  }));
                  resetFetcher.submit(
                    { intent: "seed-working-hours", days: JSON.stringify(days) },
                    { method: "post" },
                  );
                }}
              >
                <Tooltip content="Reset working hours to defaults">
                  <button
                    type="submit"
                    aria-label="Reset working hours to defaults"
                    className={iconBtn}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </resetFetcher.Form>
            </>
          )}
          {/* Master on/off switch */}
          <Toggle
            checked={enabled}
            aria-label="Working hours enabled"
            onChange={() => (enabled ? turnOff() : turnOn())}
          />
        </div>
      </div>
      {enabled && (
        <div className={cn(card, cardPad, "flex flex-col gap-2")}>
          {workingHours.map((d) => (
            <DayRow key={d.dayOfWeek} day={d} allDays={workingHours} />
          ))}
        </div>
      )}
    </section>
  );
}

type LocalSegment = { startMinute: number; endMinute: number; location: "InPerson" | "Remote" };

function DayRow({ day, allDays }: { day: WhDay; allDays: WhDay[] }) {
  const fetcher = useFetcher();
  // Optimistic state: while a submit is pending, render the in-flight values
  // rather than the loader values so edits feel instant. We submit the whole
  // week (seed-working-hours), so pull this day's slice back out of `days`.
  const pending = fetcher.formData;
  const pendingSegments: LocalSegment[] | null = (() => {
    if (!pending) return null;
    const raw = pending.get("days");
    if (typeof raw !== "string") return null;
    try {
      const parsed = JSON.parse(raw) as {
        dayOfWeek: number;
        segments: LocalSegment[];
      }[];
      return parsed.find((d) => d.dayOfWeek === day.dayOfWeek)?.segments ?? [];
    } catch {
      return null;
    }
  })();
  const segments: LocalSegment[] =
    pendingSegments ??
    day.segments.map((s) => ({
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      location: s.location,
    }));

  const enabled = segments.length > 0;

  // Persist the whole week every time so a day that currently has no DB row
  // (e.g. an unsaved default) isn't dropped by the loader's "unlisted ⇒ empty"
  // rule. `next` replaces this day's segments; other days carry through as-is.
  const submitSegments = (next: LocalSegment[]) => {
    const days = allDays.map((d) =>
      d.dayOfWeek === day.dayOfWeek
        ? { dayOfWeek: d.dayOfWeek, segments: next }
        : {
            dayOfWeek: d.dayOfWeek,
            segments: d.segments.map((s) => ({
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          },
    );
    fetcher.submit(
      { intent: "seed-working-hours", days: JSON.stringify(days) },
      { method: "post" },
    );
  };

  const toggleEnabled = () => {
    if (enabled) submitSegments([]);
    else
      submitSegments([
        { startMinute: DEFAULT_WORK_START_MIN, endMinute: DEFAULT_WORK_END_MIN, location: "InPerson" },
      ]);
  };

  const updateSegment = (idx: number, patch: Partial<LocalSegment>) => {
    const next = segments.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    submitSegments(next);
  };

  const removeSegment = (idx: number) => {
    submitSegments(segments.filter((_, i) => i !== idx));
  };

  const addSegment = () => {
    // Default new segment to start where the last one ends (or 9am if empty).
    const last = segments[segments.length - 1];
    const start = last ? Math.min(last.endMinute, 1380) : DEFAULT_WORK_START_MIN;
    const end = Math.min(start + 60, 1440);
    submitSegments([...segments, { startMinute: start, endMinute: end, location: "InPerson" }]);
  };

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={toggleEnabled}
        className={`mt-1.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled ? "bg-accent-coral border-accent-coral text-white" : "border-border bg-background"
        }`}
        aria-label={`${DAY_LABELS[day.dayOfWeek]} enabled`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </button>
      <span className="mt-1 text-sm font-medium text-foreground w-9 flex-shrink-0">
        {DAY_LABELS[day.dayOfWeek]}
      </span>
      {enabled ? (
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {segments.map((seg, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <TimeField
                valueMin={seg.startMinute}
                onCommit={(min) => updateSegment(idx, { startMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} start`}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <TimeField
                valueMin={seg.endMinute}
                onCommit={(min) => updateSegment(idx, { endMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} end`}
              />
              <div className="flex items-center gap-0.5 ml-auto">
                <LocButton
                  active={seg.location === "InPerson"}
                  onClick={() => updateSegment(idx, { location: "InPerson" })}
                  icon={<Building2 className="w-3.5 h-3.5" />}
                />
                <LocButton
                  active={seg.location === "Remote"}
                  onClick={() => updateSegment(idx, { location: "Remote" })}
                  icon={<Wifi className="w-3.5 h-3.5" />}
                />
              </div>
              {/* With a single segment the day checkbox already removes it
                  (un-checking clears the day), so the delete button only
                  appears when there are multiple segments to pick from. */}
              {segments.length > 1 && (
                <Tooltip content="Remove segment">
                  <button
                    type="button"
                    onClick={() => removeSegment(idx)}
                    aria-label={`Remove ${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1}`}
                    className="p-1 mr-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addSegment}
            className="self-start inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add segment
          </button>
        </div>
      ) : (
        <span className="mt-1 text-sm text-muted-foreground italic ml-1">Unavailable</span>
      )}
    </div>
  );
}

function TimeField({
  valueMin,
  onCommit,
  ...rest
}: { valueMin: number; onCommit: (min: number) => void } & React.AriaAttributes) {
  const { os, compactField } = useOsChrome();
  const [text, setText] = useState(formatTime(valueMin));
  // Keep text in sync if the canonical value changes externally (e.g. after submit).
  // Using a key on the parent would be cleaner, but a defaultValue + onBlur commit
  // is enough for this UI.
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseTime(text);
          if (parsed === null || parsed === valueMin) {
            setText(formatTime(valueMin));
            return;
          }
          onCommit(parsed);
        }}
        className={cn(
          "w-[88px] pl-2 pr-6 py-1 text-xs border border-border focus:outline-none",
          compactField,
          !os && "focus:ring-2 focus:ring-accent-coral/30",
        )}
      />
      <Clock className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function formatTime(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60);
  const m = minOfDay % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function parseTime(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const period = m[3]?.toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function LocButton({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-accent-coral/20 text-accent-coral" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {icon}
    </button>
  );
}

function EventBuffersCard({ bufferMin }: { bufferMin: number }) {
  const { os, card, cardPad, heading, headingIcon } = useOsChrome();
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const selectedMin = pending ? Number(pending.get("defaultEventBufferMin")) : bufferMin;
  const options: { label: string; value: number }[] = [
    { label: "None", value: 0 },
    { label: "5m", value: 5 },
    { label: "10m", value: 10 },
    { label: "15m", value: 15 },
    { label: "30m", value: 30 }
  ];
  return (
    <section>
      <h2 className={cn(heading, os ? "mb-4" : "mb-3")}>
        <Shield className={headingIcon} />
        Event Buffers
      </h2>
      <div className={cn(card, cardPad)}>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              // The fill is the only thing that says which buffer is on now
              // that the sentence under the row is gone.
              aria-pressed={selectedMin === o.value}
              onClick={() =>
                fetcher.submit(
                  { intent: "set-event-buffer", defaultEventBufferMin: String(o.value) },
                  { method: "post" },
                )
              }
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition-colors",
                os ? "rounded-full" : "rounded-md",
                selectedMin === o.value
                  ? // The os design marks a chosen segment with the container
                    // fill, as the People directory's Active/Alumni switch does.
                    os
                    ? "bg-os-container text-foreground"
                    : "bg-accent-coral text-white"
                  : os
                    ? "bg-os-well text-os-grey hover:text-foreground"
                    : "bg-background text-foreground border border-border hover:bg-muted",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ManualBlocksCard({ blocks, timezone }: { blocks: ManualBlockDTO[]; timezone: string }) {
  const { os, bodyText, heading, headingIcon, quietBtn } = useOsChrome();
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div className={cn("flex items-center justify-between", os ? "mb-4" : "mb-3")}>
        <h2 className={heading}>
          <CalendarIcon className={headingIcon} />
          Manual Blocks
        </h2>
        <button type="button" onClick={() => setAdding((v) => !v)} className={quietBtn}>
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? "Cancel" : "Add Block"}
        </button>
      </div>
      {adding && <AddManualBlockForm onDone={() => setAdding(false)} />}
      <div className="flex flex-col gap-2">
        {blocks.length === 0 && !adding && (
          <div className={cn(bodyText, "italic")}>No manual blocks.</div>
        )}
        {blocks.map((b) => (
          <ManualBlockRow key={b.id} block={b} timezone={timezone} />
        ))}
      </div>
    </section>
  );
}

function AddManualBlockForm({ onDone }: { onDone: () => void }) {
  const { os, card, cardPad, formClass, fieldLabel } = useOsChrome();
  const fetcher = useFetcher();
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  return (
    <fetcher.Form
      method="post"
      onSubmit={() => {
        // Optimistically close the form; the loader revalidation will reveal the new row.
        queueMicrotask(onDone);
      }}
      className={cn(card, formClass, cardPad, "mb-2 flex flex-col gap-2")}
    >
      <input type="hidden" name="intent" value="add-manual-block" />
      <input
        name="title"
        placeholder="Title (e.g. Dentist)"
        required
        className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
      />
      <div className="flex gap-2">
        <label className={cn("flex-1 min-w-0", fieldLabel)}>
          Start
          <DateField
            mode="datetime-local"
            name="startTimeLocal"
            required
            className="w-full min-w-0"
            value={startLocal}
            onChange={(value) => setStartLocal(value)}
          />
          <input type="hidden" name="startTime" value={startLocal ? new Date(startLocal).toISOString() : ""} readOnly />
        </label>
        <label className={cn("flex-1 min-w-0", fieldLabel)}>
          End
          <DateField
            mode="datetime-local"
            name="endTimeLocal"
            required
            className="w-full min-w-0"
            value={endLocal}
            onChange={(value) => setEndLocal(value)}
          />
          <input type="hidden" name="endTime" value={endLocal ? new Date(endLocal).toISOString() : ""} readOnly />
        </label>
      </div>
      <RepeatField
        value={repeat}
        onChange={setRepeat}
        anchorLocal={startLocal}
        labelClassName={os ? "text-sm text-os-grey" : "text-xs text-muted-foreground"}
        fieldClassName={cn(
          "w-full px-2 text-sm border border-border rounded-md bg-background text-foreground",
          !os && "h-9",
        )}
      />
      {/* The action reads `recurrenceRule` as an RRULE string; derive it from
          the friendly Repeats choice so non-technical users never see RRULE. */}
      <input type="hidden" name="recurrenceRule" value={repeatSpecToRRule(repeat) ?? ""} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className={cn(
            "px-3 py-1 text-xs font-medium",
            os
              ? "rounded-full text-os-grey hover:bg-os-container hover:text-foreground"
              : "rounded-md border border-border hover:bg-muted",
          )}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={cn(
            "px-3 py-1 text-xs font-semibold",
            os
              ? "rounded-full bg-os-accent text-os-bg hover:bg-os-accent-hover"
              : "rounded-md bg-accent-coral text-white hover:bg-accent-coral/90",
          )}
        >
          Add
        </button>
      </div>
    </fetcher.Form>
  );
}

function ManualBlockRow({ block, timezone }: { block: ManualBlockDTO; timezone: string }) {
  const { os } = useOsChrome();
  const fetcher = useFetcher();
  const removing = fetcher.state !== "idle";
  return (
    <div
      className={cn(
        "border-l-4 border-l-accent-coral px-3 py-2 flex items-start justify-between",
        // A row, not a panel: the os side takes the 12px item corner and the
        // flat card fill, keeping the coral edge that matches its grid block.
        os ? "rounded-os-item bg-os-card" : "bg-card border border-border shadow-brand-1 rounded-md",
        removing && "opacity-50",
      )}
    >
      <div>
        <div className="text-sm font-medium text-foreground">
          {block.title}
          {block.isWork && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-accent-teal/15 text-accent-teal">
              Work
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatBlockRange(block.startTime, block.endTime, timezone)}
          {block.recurrenceRule && (
            <span className="ml-1 italic">· {block.recurrenceRule}</span>
          )}
        </div>
      </div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove-manual-block" />
        <input type="hidden" name="id" value={block.id} />
        <button
          type="submit"
          aria-label={`Remove ${block.title}`}
          disabled={removing}
          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </fetcher.Form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week grids                                                          */
/* ------------------------------------------------------------------ */

function WeekToolbar({
  legend,
  monthLabel,
  weekStartIso,
  onRefresh,
  refreshing,
}: {
  // `color` is a Tailwind bg-* class; `swatch` is a raw CSS color for tints
  // that are computed at runtime (e.g. the availability gradient stops).
  // Unused today (not rendered in this component's JSX) — kept optional so
  // callers that don't have a color key to show (e.g. Timesheet, which uses
  // RoleFilterRow instead) don't need to pass a placeholder value.
  legend?: { color?: string; swatch?: string; label: string }[];
  monthLabel: string;
  weekStartIso: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { os, iconBtn } = useOsChrome();
  // Use URL-relative resolution so "?weekStart=…" stays on /calendar instead of
  // bubbling up to the parent route (which would land on /).
  const prev = `?weekStart=${shiftWeekParam(weekStartIso, -1)}`;
  const next = `?weekStart=${shiftWeekParam(weekStartIso, 1)}`;
  return (
    <div className={cn("flex items-center justify-between", os ? "mb-5" : "mb-3")}>
      <div className="flex items-center gap-3">
        <h2
          className={cn(
            "font-heading text-foreground",
            os ? "text-2xl font-medium" : "text-lg font-bold",
          )}
        >
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <Link
            to={prev}
            relative="path"
            aria-label="Previous week"
            preventScrollReset
            className={iconBtn}
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            to="?"
            relative="path"
            preventScrollReset
            className={cn(
              "text-xs font-semibold transition-colors",
              os
                ? "os-edit-btn os-add-btn--sm"
                : "px-3 py-1 rounded-md border border-border hover:bg-muted",
            )}
          >
            Today
          </Link>
          <Link
            to={next}
            relative="path"
            aria-label="Next week"
            preventScrollReset
            className={iconBtn}
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
          {onRefresh && (
            <Tooltip content={refreshing ? "Refreshing…" : "Refresh availability"}>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="Refresh availability"
                className={cn(iconBtn, "disabled:opacity-50")}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function AvailabilityWeekGrid({
  data,
  enableDragCreate = false,
}: {
  data: LoaderData;
  // When set, dragging a range commits a selection (kept drawn on the grid) and
  // opens the create-editor popover anchored beside it.
  enableDragCreate?: boolean;
}) {
  const { panel } = useOsChrome();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  useRefreshOnFocus(refresh);
  const weekStart = new Date(data.weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart.getTime() + i * 86_400_000);
    return { dayOfWeek: d.getUTCDay(), num: d.getUTCDate(), dateUtc: d };
  });

  // Committed drag selection: the grid coordinates (for drawing + anchoring the
  // popover) plus the resolved local datetime strings the editor form needs.
  const [selection, setSelection] = useState<
    | {
        dayIdx: number;
        startHour: number;
        endHour: number;
        startLocal: string;
        endLocal: string;
      }
    | null
  >(null);

  // Place one block into the right day column. Returns false if the event
  // falls outside the visible week (so callers can skip it).
  const placeBlock = (startIso: string, endIso: string, block: Omit<EventBlock, "startHour" | "duration">, into: Record<number, EventBlock[]>) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const ymd = getZonedYMD(start, data.timezone);
    const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, data.timezone);
    const startHour = (start.getTime() - dayMidnight.getTime()) / 3_600_000;
    const duration = (end.getTime() - start.getTime()) / 3_600_000;
    const dayIdx = days.findIndex(
      (d) => d.dateUtc.getUTCFullYear() === ymd.year && d.dateUtc.getUTCMonth() + 1 === ymd.month && d.dateUtc.getUTCDate() === ymd.day,
    );
    if (dayIdx < 0) return;
    if (!into[dayIdx]) into[dayIdx] = [];
    into[dayIdx].push({ startHour, duration, ...block });
  };

  // Build per-day event blocks: external (Google) events with their real title
  // and source-calendar colour, plus the user's own manual blocks.
  const eventsByDay: Record<number, EventBlock[]> = {};
  for (const e of data.externalEvents) {
    placeBlock(e.startIso, e.endIso, {
      label: e.title,
      className: e.color ? "" : EVENT_CORAL,
      bgColor: e.color ?? undefined,
      borderClassName: e.color ? undefined : "border-accent-coral-light",
      location: e.location,
      description: e.description,
      organizerName: e.organizerName,
      attendees: e.attendees,
      links: e.links,
    }, eventsByDay);
  }
  for (const b of data.manualBlocks) {
    placeBlock(b.startTime, b.endTime, {
      label: b.title || "Busy",
      className: EVENT_CORAL,
      borderClassName: "border-accent-coral-light",
    }, eventsByDay);
  }
  // Meeting invites: clickable RSVP blocks, styled by response state.
  // A Meeting-sourced TimeEntry for this meeting is what "Add to timesheet"
  // toggles, so the popover reads its checked state straight off the loader's
  // time entries rather than refetching per block.
  const meetingIdsOnTimesheet = new Set(
    data.timeEntries.flatMap((t) => (t.scheduledMeetingId ? [t.scheduledMeetingId] : [])),
  );
  for (const inv of data.meetingInvites) {
    const style = meetingBlockStyle(inv.rsvp);
    placeBlock(inv.startIso, inv.endIso, {
      label: inv.title,
      className: style.className,
      borderClassName: style.borderClassName,
      organizerName: inv.organizerName ?? undefined,
      attendees: inv.attendees,
      meeting: {
        notificationId: inv.notificationId,
        meetingId: inv.meetingId,
        rsvp: inv.rsvp,
        notePageId: inv.notePageId,
        onTimesheet: meetingIdsOnTimesheet.has(inv.meetingId),
        isCoreMeeting: inv.isCoreMeeting,
        canMarkCoreMeeting: data.canMarkCoreMeeting,
      },
    }, eventsByDay);
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: data.timezone,
    month: "long",
    year: "numeric",
  }).format(weekStart);

  // Legend: one swatch per enabled, coloured sub-calendar (so a multi-calendar
  // week shows which colour maps to which calendar). Dedupe by colour.
  const calLegend: { swatch: string; label: string }[] = [];
  const seenColors = new Set<string>();
  for (const link of data.calendarLinks) {
    for (const sub of link.subCalendars ?? []) {
      if (sub.enabled && sub.color && !seenColors.has(sub.color)) {
        seenColors.add(sub.color);
        calLegend.push({ swatch: sub.color, label: sub.summary });
      }
    }
  }

  return (
    <section className={cn(panel, "p-4 flex flex-col lg:flex-1 lg:min-h-0")}>
      <WeekToolbar
        monthLabel={monthLabel}
        weekStartIso={data.weekStartIso}
        onRefresh={refresh}
        refreshing={revalidator.state !== "idle"}
        legend={[
          // Free time is left uncolored, so it carries no legend swatch.
          // Only meaningful when working hours are on (otherwise no stripes).
          ...(data.hasPersistedWorkingHours
            ? [{ color: "bg-muted", label: "Outside Hours" }]
            : []),
          // Per-calendar colours when available; else a single generic "Busy".
          ...(calLegend.length > 0
            ? calLegend
            : [{ color: "bg-accent-coral", label: "Busy" }]),
        ]}
      />
      <WeekGrid
        fillAndScroll
        days={days}
        showProviderRow
        showSubHourGrid
        timezone={data.timezone}
        backgroundLayer={(dayIdx) =>
          workingHoursStripeLayer(data.workingHours, days[dayIdx].dayOfWeek, {
            enabled: data.hasPersistedWorkingHours,
          })
        }
        eventsByDay={eventsByDay}
        onDayPointerSelect={
          enableDragCreate
            ? (dayIdx, startHour, endHour) => {
                const day = days[dayIdx];
                if (!day) return;
                setSelection({
                  dayIdx,
                  startHour,
                  endHour,
                  startLocal: dayHourToLocal(day.dateUtc, startHour),
                  endLocal: dayHourToLocal(day.dateUtc, endHour),
                });
              }
            : undefined
        }
        selection={
          selection
            ? { dayIdx: selection.dayIdx, startHour: selection.startHour, endHour: selection.endHour }
            : null
        }
        selectionPopover={
          selection
            ? () => (
                <CreateFromDragPopover
                  startLocal={selection.startLocal}
                  endLocal={selection.endLocal}
                  myRoles={data.myRoles}
                  onClose={() => setSelection(null)}
                />
              )
            : undefined
        }
        onSelectionDismiss={() => setSelection(null)}
        onSelectionResize={(startHour, endHour) =>
          setSelection((prev) => {
            if (!prev) return prev;
            const day = days[prev.dayIdx];
            if (!day) return prev;
            return {
              ...prev,
              startHour,
              endHour,
              startLocal: dayHourToLocal(day.dateUtc, startHour),
              endLocal: dayHourToLocal(day.dateUtc, endHour),
            };
          })
        }
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule view                                                        */
/* ------------------------------------------------------------------ */

// Shown wherever time can be logged but the user holds no paid role. Every
// entry must attribute to one, so there's nothing valid to submit.
const NO_ROLES_MESSAGE =
  "You have no paid roles this term, so there's nothing to log hours against.";

// The add-entry row mixes a date input, two time inputs, a select and a
// textarea. Each of those sizes itself from its own intrinsic content — the
// native date/time widgets and the select spinner all differ, and by locale —
// so equal padding does not produce equal heights. Pin them instead.
const FIELD_BASE = "h-9 px-2 text-sm border";

// Overlay-by-default, toggle-to-narrow chip row above the Timesheet grid —
// mirrors SubCalendarRow's toggle-chip pattern but is a pure client-side
// filter (no server round-trip): excludedKeys tracks which buckets are
// hidden, so a fresh page load with no interaction shows everything overlaid.
function RoleFilterRow({
  buckets,
  excludedKeys,
  onToggle,
}: {
  buckets: { key: string; label: string; hours: number }[];
  excludedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  // Single-bucket weeks still get the row: the chip doubles as this week's
  // per-role hours readout, which is useful even when there's nothing to
  // filter against.
  if (buckets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
      {buckets.map((b) => {
        const active = !excludedKeys.has(b.key);
        const color = roleColor(b.key);
        return (
          <Tooltip key={b.key} content={`${b.label} — ${b.hours.toFixed(2)} hrs this week${active ? "" : " (hidden)"}`}>
            <button
              type="button"
              onClick={() => onToggle(b.key)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs transition-colors ${
                active
                  ? "border-border bg-muted/60 text-foreground"
                  : "border-border/50 text-muted-foreground opacity-50"
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color.dot }} />
              {b.label}
              <span className={active ? "text-muted-foreground" : ""}>· {b.hours.toFixed(2)}h</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Encodes a RoleInstance into a single <select> option value (assignmentType
// and roleRefId travel together — see calendar-schemas.ts's assignmentType).
function roleOptionKey(role: RoleInstance): string {
  return `${role.assignmentType}:${role.roleRefId}`;
}

function parseRoleOptionKey(
  key: string,
): { assignmentType: RoleInstance["assignmentType"]; roleRefId: string } | null {
  if (!key) return null;
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  return {
    assignmentType: key.slice(0, idx) as RoleInstance["assignmentType"],
    roleRefId: key.slice(idx + 1),
  };
}

// Role picker for a plain (non-fetch, name-attribute-driven) <Form> — pairs a
// controlled <select> with hidden assignmentType/roleRefId inputs so native
// FormData submission carries both halves of the encoded role key.
// Controlled by the parent so submit can be gated on a role actually being
// picked (the disabled placeholder below is not a submittable choice).
function RoleSelectField({
  id,
  myRoles,
  value,
  onChange,
}: {
  id: string;
  myRoles: RoleInstance[];
  value: string;
  onChange: (next: string) => void;
}) {
  const { fieldLabel, compactField } = useOsChrome();
  const parsed = parseRoleOptionKey(value);
  return (
    <label htmlFor={id} className={fieldLabel}>
      Role
      <Select
        value={value}
        onChange={onChange}
        placeholder="Select a role…"
        options={myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
        buttonClassName={cn(
          FIELD_BASE,
          compactField,
          value ? "border-border" : "border-red-500",
          "inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40",
        )}
      />
      <input type="hidden" name="assignmentType" value={parsed?.assignmentType ?? ""} />
      <input type="hidden" name="roleRefId" value={parsed?.roleRefId ?? ""} />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Drag-to-create side modal (My Availability tab)                      */
/* ------------------------------------------------------------------ */

function CreateFromDragPopover({
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  const { os, popover, formClass, fieldLabel, formTrigger } = useOsChrome();
  const revalidator = useRevalidator();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(startLocal);
  const [end, setEnd] = useState(endLocal);
  // Follow the committed selection while the user resizes it on the grid (the
  // startLocal/endLocal props change). Manual edits to the inputs below still
  // win until the next resize re-syncs.
  useEffect(() => {
    setStart(startLocal);
    setEnd(endLocal);
  }, [startLocal, endLocal]);
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  // Optional "add to timesheet": marking the block as work also creates a
  // role-tagged TimeEntry. Meetings aren't created here — their time comes from
  // group availability, not a pre-picked slot; book them via New → Meeting.
  const [isWork, setIsWork] = useState(false);
  const [roleKey, setRoleKey] = useState(myRoles.length > 0 ? roleOptionKey(myRoles[0]!) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid =
    !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const isRecurring = repeat.freq !== "none";
  const canSubmit =
    title.trim().length > 0 &&
    startEndValid &&
    !submitting &&
    // "Add to timesheet" needs a role — but it's ignored on a recurring block
    // (a series can't be work), so don't block submit in that case.
    (!isWork || isRecurring || roleKey !== "");

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // Block and Log time both create a manual block — Log time just marks it
      // as work against a role (which syncs to a TimeEntry).
      const body = new FormData();
      body.set("intent", "add-manual-block");
      body.set("title", title.trim());
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      const rrule = repeatSpecToRRule(repeat);
      if (rrule) body.set("recurrenceRule", rrule);
      if (isWork && !isRecurring) {
        const role = parseRoleOptionKey(roleKey);
        if (role) {
          body.set("isWork", "true");
          body.set("assignmentType", role.assignmentType);
          body.set("roleRefId", role.roleRefId);
        }
      }
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to create block");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const cancelBtn =
    "px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted";
  const primaryBtn =
    "px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50";

  return (
    <div
      className={cn("w-80 max-h-[30rem] overflow-y-auto", popover)}
      role="dialog"
      aria-modal="false"
      aria-label="Create on the calendar"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">New block</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className={cn("p-3 space-y-3", formClass)}>
          <div>
            <label htmlFor="drag-title" className="block text-sm font-medium text-foreground mb-1">
              Title
            </label>
            <input
              id="drag-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Focus time"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="drag-start" className="block text-sm font-medium text-foreground mb-1">
                Starts
              </label>
              <DateField
                mode="datetime-local"
                value={start}
                onChange={(value) => setStart(value)}
                className="w-full"
                ariaLabel="Starts"
              />
            </div>
            <div>
              <label htmlFor="drag-end" className="block text-sm font-medium text-foreground mb-1">
                Ends
              </label>
              <DateField
                mode="datetime-local"
                value={end}
                min={start || undefined}
                onChange={(value) => setEnd(value)}
                className="w-full"
                ariaLabel="Ends"
              />
            </div>
          </div>
          {!startEndValid && <p className="text-xs text-red-600">End must be after start.</p>}

          <RepeatField
            value={repeat}
            onChange={setRepeat}
            anchorLocal={start}
            labelClassName="block text-sm font-medium text-foreground mb-1"
            fieldClassName={cn(
              "w-full px-3 text-sm border border-border rounded-md bg-background text-foreground",
              !os && "h-9",
            )}
          />

          {/* Optional: also log this block as work against a role. Recurring
              blocks can't be work, so this hides once a repeat is chosen. */}
          {myRoles.length > 0 && !isRecurring && (
            <div>
              <Checkbox
                label="Add to timesheet"
                checked={isWork}
                onChange={(e) => setIsWork(e.target.checked)}
                className="text-sm font-medium text-foreground"
              />
              {isWork && (
                <Select
                  ariaLabel="Which role is this work for"
                  value={roleKey}
                  onChange={(v) => setRoleKey(v)}
                  placeholder="Select a role…"
                  options={myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
                  buttonClassName={cn("mt-2 border-border", !roleKey && "border-red-500", formTrigger)}
                />
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={cancelBtn}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className={primaryBtn}>
              {submitting ? "Saving…" : "Add block"}
            </button>
          </div>
        </form>
    </div>
  );
}

function ScheduleView({ data }: { data: LoaderData }) {
  const [searchParams] = useSearchParams();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  // A deep link from a project hub ("Schedule meeting") pre-selects that
  // project's team group. It only resolves when the group is one of the
  // sender's visible groups — the picker couldn't offer it otherwise — so this
  // silently no-ops for viewers who aren't on the project.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() => {
    const projectParam = searchParams.get("project");
    if (!projectParam) return [];
    const g = data.groups.find((grp) => grp.projectId === projectParam);
    return g ? [g.id] : [];
  });
  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");

  const groupsById = new Map(data.groups.map((g) => [g.id, g]));
  const resolvedParticipantIds = (() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  })();

  const duration = durationMinutesBetween(startLocal, endLocal);

  const handleGridSelect = (newStartLocal: string, newEndLocal: string) => {
    setStartLocal(newStartLocal);
    setEndLocal(newEndLocal);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-full min-w-0 lg:min-h-[calc(100vh-9rem)]">
      <CreateScheduledMeetingForm
        groups={data.groups}
        users={data.users}
        calendarLinks={data.calendarLinks}
        myProjects={data.myProjects}
        canSetSelfCheckIn={data.canSetSelfCheckIn}
        startLocal={startLocal}
        onStartLocalChange={setStartLocal}
        endLocal={endLocal}
        onEndLocalChange={setEndLocal}
        selectedUserIds={selectedUserIds}
        onChangeSelectedUserIds={setSelectedUserIds}
        selectedGroupIds={selectedGroupIds}
        onChangeSelectedGroupIds={setSelectedGroupIds}
        resolvedParticipantIds={resolvedParticipantIds}
      />
      <ScheduleWeekGrid
        // The organizer is always implicitly invited, so include them in the
        // availability query — otherwise the "All free" overlay can paint over
        // times when the sender themself is busy.
        participantIds={
          resolvedParticipantIds.length > 0
            ? Array.from(new Set([...resolvedParticipantIds, data.currentUserId]))
            : [data.currentUserId]
        }
        showingSelfOnly={resolvedParticipantIds.length === 0}
        users={data.users}
        workingHours={data.workingHours}
        workingHoursEnabled={data.hasPersistedWorkingHours}
        durationMinutes={duration}
        timezone={data.timezone}
        weekStartIso={data.weekStartIso}
        weekEndIso={data.weekEndIso}
        onSelectRange={handleGridSelect}
        selectedStartLocal={startLocal}
        selectedEndLocal={endLocal}
      />
    </div>
  );
}

function userLabel(u: UserOption) {
  const name = fullName(u);
  return name || u.daliEmail || u.id;
}

function TimesheetView({ data }: { data: LoaderData }) {
  const { os, card, panelPad, heading, compactField, fieldLabel } = useOsChrome();
  const addFetcher = useFetcher<{ error?: string } | null>();
  const adding = addFetcher.state !== "idle";
  const [date, setDate] = useState(() => todayDateInputValue(data.timezone));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [note, setNote] = useState("");
  const hasRoles = data.myRoles.length > 0;
  // Preselect only when there's exactly one role — otherwise force a choice
  // rather than defaulting to an arbitrary one.
  const [roleKey, setRoleKey] = useState(
    data.myRoles.length === 1 ? roleOptionKey(data.myRoles[0]!) : "",
  );

  function resetAddForm() {
    setDate(todayDateInputValue(data.timezone));
    setStartTime("09:00");
    setEndTime("10:00");
    setNote("");
    setRoleKey(data.myRoles.length === 1 ? roleOptionKey(data.myRoles[0]!) : "");
  }

  const startIso = date && startTime ? localDayTimeToIso(date, startTime, data.timezone) : null;
  const endIso = date && endTime ? localDayTimeToIso(date, endTime, data.timezone) : null;
  const hours =
    startIso && endIso
      ? Math.round(((new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000) * 100) /
        100
      : 0;
  // Mirror the server's rules (validateTimeEntryRange) so the button is only
  // live for something that will actually save.
  const rangeError =
    !startIso || !endIso
      ? "Enter a date, start and end time."
      : hours <= 0
        ? "End time must be after start time."
        : hours > 24
          ? "An entry can't be longer than 24 hours."
          : !roleKey
            ? "Pick a role to log this time against."
            : null;
  const canSubmit = hasRoles && !rangeError && !adding && note.trim() !== "";
  const serverError = addFetcher.data?.error ?? null;

  return (
    <div className="flex flex-col gap-4 w-full max-w-full min-w-0">
      <section className={cn(card, panelPad)}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className={heading}>Timesheet</h2>
          {/* Adding an outside job is how someone with no current DALI
              assignment gets a role to log against, so it stays reachable even
              when the form below is showing the no-roles message. */}
          <CustomHiresManager
            hires={data.myRoles
              .filter((r) => r.assignmentType === "Custom")
              .map((r) => ({ id: r.roleRefId, label: r.label }))}
          />
        </div>
        {!hasRoles ? (
          <p className="text-xs text-red-600">{NO_ROLES_MESSAGE}</p>
        ) : (
          <addFetcher.Form
            method="post"
            onSubmit={(e) => {
              if (!canSubmit) {
                e.preventDefault();
                return;
              }
              // Defer so the fetcher can read current field values first.
              queueMicrotask(() => resetAddForm());
            }}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(8rem,1fr)_7rem_7rem_minmax(9rem,1.2fr)_minmax(12rem,1.8fr)_auto]"
          >
            <input type="hidden" name="intent" value="add-time-entry" />
            {/* Hours is derived from the range, never typed — the server
                re-derives and rejects any mismatch. */}
            <input type="hidden" name="hours" value={hours > 0 ? String(hours) : ""} />
            <input type="hidden" name="startTime" value={startIso ?? ""} />
            <input type="hidden" name="endTime" value={endIso ?? ""} />
            <label className={fieldLabel}>
              Date
              <DateField
                mode="date"
                name="date"
                required
                value={date}
                onChange={(value) => setDate(value)}
                className="w-full"
                ariaLabel="Date"
              />
            </label>
            <label className={fieldLabel}>
              Start
              <DateField
                mode="time"
                required
                value={startTime}
                onChange={(value) => setStartTime(value)}
                className="w-full"
                ariaLabel="Start time"
              />
            </label>
            <label className={fieldLabel}>
              End
              <DateField
                mode="time"
                required
                value={endTime}
                onChange={(value) => setEndTime(value)}
                className="w-full"
                ariaLabel="End time"
              />
            </label>
            <RoleSelectField
              id="add-time-entry-role"
              myRoles={data.myRoles}
              value={roleKey}
              onChange={setRoleKey}
            />
            <label className={cn(fieldLabel, "sm:col-span-2 xl:col-span-1")}>
              Note
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={1}
                placeholder="What did you work on?"
                // Starts level with the rest of the row; drag to grow for a
                // longer note. A textarea is top-aligned rather than centred
                // like an input, hence the explicit vertical padding.
                className={cn(FIELD_BASE, compactField, "border-border py-2 min-h-9 resize-y")}
              />
            </label>
            <div className="flex items-center gap-1.5 sm:col-span-2 sm:justify-end xl:col-span-1 xl:justify-start">
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "h-9 px-3 text-xs font-semibold disabled:opacity-50",
                  os
                    ? "rounded-full bg-os-accent text-os-bg hover:bg-os-accent-hover"
                    : "rounded-md bg-accent-coral text-white hover:bg-accent-coral/90",
                )}
              >
                Add
              </button>
              <Tooltip content="Reset">
                <button
                  type="button"
                  onClick={resetAddForm}
                  aria-label="Reset"
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center text-xs font-semibold transition-colors",
                    os
                      ? "rounded-os-item text-os-grey hover:bg-os-container hover:text-foreground"
                      : "rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <RotateCcw className="w-3 h-3" aria-hidden />
                </button>
              </Tooltip>
            </div>
          </addFetcher.Form>
        )}

        {hasRoles && (
          <p
            className={`mt-2 text-xs ${rangeError ? "text-red-600" : "text-muted-foreground"}`}
            role={rangeError ? "alert" : undefined}
          >
            {rangeError ?? `${hours.toFixed(2)} hrs`}
          </p>
        )}
        {serverError && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {serverError}
          </p>
        )}
      </section>

      <TimesheetWeekGrid data={data} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timesheet week grid — mirrors AvailabilityWeekGrid: shows blocks from    */
/* linked calendars + personal blocks for context, plus this user's         */
/* timed TimeEntry rows, and supports drag-to-create a new manual entry.    */
/* ------------------------------------------------------------------ */

type TimesheetSelection = {
  dayIdx: number;
  startHour: number;
  endHour: number;
  startLocal: string;
  endLocal: string;
} & ({ mode: "create" } | { mode: "edit"; entry: TimeEntryDTO });

function TimesheetWeekGrid({ data }: { data: LoaderData }) {
  const { panel } = useOsChrome();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  useRefreshOnFocus(refresh);
  const weekStart = new Date(data.weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart.getTime() + i * 86_400_000);
    return { dayOfWeek: d.getUTCDay(), num: d.getUTCDate(), dateUtc: d };
  });

  const [selection, setSelection] = useState<TimesheetSelection | null>(null);
  // Which role buckets are hidden — empty by default so all roles overlay.
  const [excludedRoleKeys, setExcludedRoleKeys] = useState<Set<string>>(new Set());
  const toggleRoleKey = (key: string) =>
    setExcludedRoleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Maps an ISO start/end range onto this week's grid coordinates. Shared by
  // block placement (below) and by openEdit (which needs the same math run
  // in reverse to anchor the edit popover on an existing block's slot).
  const toGridRange = (startIso: string, endIso: string) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const ymd = getZonedYMD(start, data.timezone);
    const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, data.timezone);
    const startHour = (start.getTime() - dayMidnight.getTime()) / 3_600_000;
    const endHour = startHour + (end.getTime() - start.getTime()) / 3_600_000;
    const dayIdx = days.findIndex(
      (d) => d.dateUtc.getUTCFullYear() === ymd.year && d.dateUtc.getUTCMonth() + 1 === ymd.month && d.dateUtc.getUTCDate() === ymd.day,
    );
    return { dayIdx, startHour, endHour };
  };

  const placeBlock = (
    startIso: string,
    endIso: string,
    block: Omit<EventBlock, "startHour" | "duration">,
    into: Record<number, EventBlock[]>,
  ) => {
    const { dayIdx, startHour, endHour } = toGridRange(startIso, endIso);
    if (dayIdx < 0) return;
    if (!into[dayIdx]) into[dayIdx] = [];
    into[dayIdx].push({ startHour, duration: endHour - startHour, ...block });
  };

  const openEdit = (entry: TimeEntryDTO, startIso: string, endIso: string) => {
    const { dayIdx, startHour, endHour } = toGridRange(startIso, endIso);
    const day = days[dayIdx];
    if (!day) return;
    setSelection({
      mode: "edit",
      entry,
      dayIdx,
      startHour,
      endHour,
      startLocal: dayHourToLocal(day.dateUtc, startHour),
      endLocal: dayHourToLocal(day.dateUtc, endHour),
    });
  };

  // The Timesheet grid shows logged work ONLY — it's a record of paid hours,
  // so an ordinary calendar event (a linked Google event, or a personal block
  // not marked as work) has no place on it and is deliberately not drawn.
  // Blocks that ARE marked as work already surface here via their synced
  // source:"Block" TimeEntry (see syncManualBlockTimeEntry), so rendering
  // data.manualBlocks too would double-draw them. Availability's grid still
  // shows the full picture — that's the tab for "when am I busy".
  //
  // Below: this user's TimeEntry rows — timed ones at their real time; untimed
  // ones (e.g. attendance on a meeting with no confirmed start time yet) at a
  // nominal 9am slot so every entry is still visible somewhere. Every entry is
  // clickable to edit role/time/note via the same TimesheetEditPopover.
  const eventsByDay: Record<number, EventBlock[]> = {};
  // One filter chip per role bucket actually present among this week's
  // entries (plus "Unassigned"), so every visible block always has a
  // matching chip — even for a role no longer in data.myRoles.
  // The loader sends the last 200 entries, not just this week's, so resolve
  // each entry's grid range once and keep only those landing on a visible day
  // (dayIdx < 0 = outside this week — exactly what placeBlock drops). That
  // keeps the chips' hours honest: they total what's actually drawn.
  const weekEntries: { t: TimeEntryDTO; startIso: string; endIso: string }[] = [];
  for (const t of data.timeEntries) {
    const { startIso, endIso } =
      t.startTime && t.endTime
        ? { startIso: t.startTime, endIso: t.endTime }
        : nominalDayRange(t.date, t.hours, data.timezone);
    if (toGridRange(startIso, endIso).dayIdx < 0) continue;
    weekEntries.push({ t, startIso, endIso });
  }

  // Per-role hours accumulate across the pay period the visible week belongs
  // to, and start over at the next one — that's the unit payroll approves and
  // pays in, so a week-only total answered a question nobody asks. Periods
  // start on a Sunday, so the displayed Sun–Sat week is always inside exactly
  // one of them.
  const weekPeriod = payPeriodFor(weekStart);
  const periodEntries = data.timeEntries.filter(
    (t) => payPeriodFor(timeEntryDayUtc(t, data.timezone)).index === weekPeriod.index,
  );

  const roleBuckets = new Map<string, { key: string; label: string; hours: number }>();
  // Seed from what's drawn this week so every visible block still has a chip,
  // then total the period into it.
  for (const { t } of weekEntries) {
    const key = timeEntryRoleKey(t);
    if (roleBuckets.has(key)) continue;
    const known =
      t.assignmentType && t.roleRefId
        ? data.myRoles.find((r) => r.assignmentType === t.assignmentType && r.roleRefId === t.roleRefId)
        : undefined;
    roleBuckets.set(key, {
      key,
      label: known?.label ?? (key === UNASSIGNED_ROLE_KEY ? "Unassigned" : "Other role"),
      hours: 0,
    });
  }
  for (const t of periodEntries) {
    const key = timeEntryRoleKey(t);
    const existing = roleBuckets.get(key);
    if (existing) {
      existing.hours += t.hours;
      continue;
    }
    const known =
      t.assignmentType && t.roleRefId
        ? data.myRoles.find((r) => r.assignmentType === t.assignmentType && r.roleRefId === t.roleRefId)
        : undefined;
    roleBuckets.set(key, {
      key,
      label: known?.label ?? (key === UNASSIGNED_ROLE_KEY ? "Unassigned" : "Other role"),
      hours: t.hours,
    });
  }

  for (const { t, startIso, endIso } of weekEntries) {
    const roleKey = timeEntryRoleKey(t);
    if (excludedRoleKeys.has(roleKey)) continue;
    const color = roleColor(roleKey);
    placeBlock(
      startIso,
      endIso,
      {
        label: t.source === "Meeting" ? t.note || "Meeting" : t.note || "Time entry",
        className: color.className,
        borderClassName: color.borderClassName,
        onClick: () => openEdit(t, startIso, endIso),
      },
      eventsByDay,
    );
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: data.timezone,
    month: "long",
    year: "numeric",
  }).format(weekStart);

  return (
    <section className={cn(panel, "p-4 flex flex-col")}>
      <WeekToolbar
        monthLabel={monthLabel}
        weekStartIso={data.weekStartIso}
        onRefresh={refresh}
        refreshing={revalidator.state !== "idle"}
      />
      {/* Names the window the chip hours cover, so "12.5h" isn't mistaken for
          this week's total. */}
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
        Hours below are for the pay period{" "}
        <span className="font-medium text-foreground">
          {formatPayPeriod(weekPeriod, data.timezone)}
        </span>
        .
      </p>
      <RoleFilterRow
        buckets={Array.from(roleBuckets.values())}
        excludedKeys={excludedRoleKeys}
        onToggle={toggleRoleKey}
      />
      <WeekGrid
        days={days}
        showSubHourGrid
        markPayPeriodEnds
        timezone={data.timezone}
        eventsByDay={eventsByDay}
        onDayPointerSelect={(dayIdx, startHour, endHour) => {
          const day = days[dayIdx];
          if (!day) return;
          setSelection({
            mode: "create",
            dayIdx,
            startHour,
            endHour,
            startLocal: dayHourToLocal(day.dateUtc, startHour),
            endLocal: dayHourToLocal(day.dateUtc, endHour),
          });
        }}
        selection={
          selection
            ? { dayIdx: selection.dayIdx, startHour: selection.startHour, endHour: selection.endHour }
            : null
        }
        selectionPopover={
          selection
            ? () =>
                selection.mode === "create" ? (
                  <TimesheetDragPopover
                    startLocal={selection.startLocal}
                    endLocal={selection.endLocal}
                    myRoles={data.myRoles}
                    onClose={() => setSelection(null)}
                  />
                ) : (
                  <TimesheetEditPopover
                    entry={selection.entry}
                    startLocal={selection.startLocal}
                    endLocal={selection.endLocal}
                    myRoles={data.myRoles}
                    onClose={() => setSelection(null)}
                  />
                )
            : undefined
        }
        onSelectionDismiss={() => setSelection(null)}
        // Wired for both modes: a committed entry can be dragged/resized on the
        // grid to retime it, not just a fresh drag-selection. The popover form
        // follows the block live (both popovers sync off startLocal/endLocal).
        onSelectionResize={(startHour, endHour) =>
          setSelection((prev) => {
            if (!prev) return prev;
            const day = days[prev.dayIdx];
            if (!day) return prev;
            return {
              ...prev,
              startHour,
              endHour,
              startLocal: dayHourToLocal(day.dateUtc, startHour),
              endLocal: dayHourToLocal(day.dateUtc, endHour),
            };
          })
        }
      />
    </section>
  );
}

function TimesheetDragPopover({
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  const { popover, formClass, fieldLabel, formTrigger } = useOsChrome();
  const revalidator = useRevalidator();
  const [start, setStart] = useState(startLocal);
  const [end, setEnd] = useState(endLocal);
  // Follow the committed selection while the user resizes it on the grid.
  useEffect(() => {
    setStart(startLocal);
    setEnd(endLocal);
  }, [startLocal, endLocal]);
  const [roleKey, setRoleKey] = useState(myRoles.length === 1 ? roleOptionKey(myRoles[0]!) : "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const hours = startEndValid
    ? Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100
    : 0;
  const canSubmit = startEndValid && hours > 0 && !!roleKey && !submitting && note.trim() !== "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("intent", "add-time-entry");
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      body.set("date", start.slice(0, 10));
      body.set("hours", String(hours));
      const role = parseRoleOptionKey(roleKey);
      if (role) {
        body.set("assignmentType", role.assignmentType);
        body.set("roleRefId", role.roleRefId);
      }
      if (note.trim()) body.set("note", note.trim());
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to add entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={cn("w-80 max-h-[26rem] overflow-y-auto", popover)}
      role="dialog"
      aria-modal="false"
      aria-label="New timesheet entry"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">New timesheet entry</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className={cn("p-3 space-y-3", formClass)}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-drag-start" className="block text-sm font-medium text-foreground mb-1">
              Starts
            </label>
            <DateField
              mode="datetime-local"
              value={start}
              onChange={(value) => setStart(value)}
              className="w-full"
              ariaLabel="Starts"
            />
          </div>
          <div>
            <label htmlFor="ts-drag-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <DateField
              mode="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(value) => setEnd(value)}
              className="w-full"
              ariaLabel="Ends"
            />
          </div>
        </div>
        {!startEndValid ? (
          <p className="text-xs text-red-600">End must be after start.</p>
        ) : (
          <p className="text-xs text-muted-foreground">{hours.toFixed(2)} hrs</p>
        )}

        <div>
          <label htmlFor="ts-drag-role" className="block text-sm font-medium text-foreground mb-1">
            Role
          </label>
          {myRoles.length === 0 ? (
            <p className="text-xs text-red-600">{NO_ROLES_MESSAGE}</p>
          ) : (
            <Select
              value={roleKey}
              onChange={(v) => setRoleKey(v)}
              placeholder="Select a role…"
              options={myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
              buttonClassName={`${formTrigger} ${
                roleKey ? "border-border" : "border-red-500"
              }`}
            />
          )}
        </div>

        <div>
          <label htmlFor="ts-drag-note" className="block text-sm font-medium text-foreground mb-1">
            Note
          </label>
          <textarea
            id="ts-drag-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did you work on?"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground resize-y min-h-[4.5rem]"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add entry"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Opened by clicking any TimeEntry on the Timesheet week grid (Manual, Block,
// or Meeting). Same shape as TimesheetDragPopover but pre-filled, with Save
// and Delete instead of Add.
function TimesheetEditPopover({
  entry,
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  entry: TimeEntryDTO;
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  const { popover, formClass, fieldLabel, formTrigger } = useOsChrome();
  const revalidator = useRevalidator();
  const [start, setStart] = useState(startLocal);
  const [end, setEnd] = useState(endLocal);
  // Follow the block while it's dragged/resized on the grid, so the form and
  // the block never disagree (same as TimesheetDragPopover). Typing into the
  // inputs still wins until the next grid drag.
  useEffect(() => {
    setStart(startLocal);
    setEnd(endLocal);
  }, [startLocal, endLocal]);
  const [roleKey, setRoleKey] = useState(
    entry.assignmentType && entry.roleRefId
      ? `${entry.assignmentType}:${entry.roleRefId}`
      : "",
  );
  const [note, setNote] = useState(entry.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const hours = startEndValid
    ? Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100
    : 0;
  const busy = submitting || deleting;
  const canSubmit = startEndValid && hours > 0 && !!roleKey && !busy && note.trim() !== "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      const role = parseRoleOptionKey(roleKey);
      body.set("intent", "update-time-entry");
      body.set("id", entry.id);
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      body.set("date", start.slice(0, 10));
      body.set("hours", String(hours));
      body.set("assignmentType", role?.assignmentType ?? "");
      body.set("roleRefId", role?.roleRefId ?? "");
      body.set("note", note.trim());
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to save entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function del() {
    setDeleting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("intent", "delete-time-entry");
      body.set("id", entry.id);
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to delete entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={cn("w-80 max-h-[26rem] overflow-y-auto", popover)}
      role="dialog"
      aria-modal="false"
      aria-label="Edit timesheet entry"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">Edit timesheet entry</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className={cn("p-3 space-y-3", formClass)}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-edit-start" className="block text-sm font-medium text-foreground mb-1">
              Starts
            </label>
            <DateField
              mode="datetime-local"
              value={start}
              onChange={(value) => setStart(value)}
              className="w-full"
              ariaLabel="Starts"
            />
          </div>
          <div>
            <label htmlFor="ts-edit-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <DateField
              mode="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(value) => setEnd(value)}
              className="w-full"
              ariaLabel="Ends"
            />
          </div>
        </div>
        {!startEndValid ? (
          <p className="text-xs text-red-600">End must be after start.</p>
        ) : (
          <p className="text-xs text-muted-foreground">{hours.toFixed(2)} hrs</p>
        )}

        <div>
          <label htmlFor="ts-edit-role" className="block text-sm font-medium text-foreground mb-1">
            Role
          </label>
          <Select
            value={roleKey}
            onChange={(v) => setRoleKey(v)}
            placeholder="Select a role…"
            options={[
              ...(roleKey && !myRoles.some((r) => roleOptionKey(r) === roleKey)
                ? [{ value: roleKey, label: "Current role (no longer active)" }]
                : []),
              ...myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label })),
            ]}
            buttonClassName={`${formTrigger} ${
              roleKey ? "border-border" : "border-red-500"
            }`}
          />
          {!roleKey && <p className="mt-1 text-xs text-red-600">Pick a role to save this entry.</p>}
        </div>

        <div>
          <label htmlFor="ts-edit-note" className="block text-sm font-medium text-foreground mb-1">
            Note
          </label>
          <textarea
            id="ts-edit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did you work on?"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground resize-y min-h-[4.5rem]"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="px-3 py-2 text-sm font-medium rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CreateScheduledMeetingForm({
  groups,
  users,
  calendarLinks,
  myProjects,
  canSetSelfCheckIn,
  startLocal,
  onStartLocalChange,
  endLocal,
  onEndLocalChange,
  selectedUserIds,
  onChangeSelectedUserIds,
  selectedGroupIds,
  onChangeSelectedGroupIds,
  resolvedParticipantIds,
}: {
  groups: GroupOption[];
  users: UserOption[];
  calendarLinks: CalendarLinkDTO[];
  myProjects: ProjectOption[];
  canSetSelfCheckIn: boolean;
  startLocal: string;
  onStartLocalChange: (v: string) => void;
  endLocal: string;
  onEndLocalChange: (v: string) => void;
  selectedUserIds: string[];
  onChangeSelectedUserIds: (ids: string[]) => void;
  selectedGroupIds: string[];
  onChangeSelectedGroupIds: (ids: string[]) => void;
  resolvedParticipantIds: string[];
}) {
  const { panel, panelPad, formClass } = useOsChrome();
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  const googleLinks = calendarLinks.filter((l) => l.provider === "Google" && l.enabled);
  const [organizerCalendarLinkId, setOrganizerCalendarLinkId] = useState<string>(
    googleLinks[0]?.id ?? "",
  );
  // Meeting notes are opt-in — type/label/project only appear when this is on.
  const [createNote, setCreateNote] = useState(false);
  const [meetingType, setMeetingType] = useState<"Team" | "Partner" | "Other">("Other");
  const [meetingTypeLabel, setMeetingTypeLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  // Self check-in is independent of the meeting note (QR lives on the note when
  // one exists, otherwise on /calendar/check-in/:id).
  const [selfCheckIn, setSelfCheckIn] = useState(false);
  const [status, setStatus] = useState<
    | null
    | {
        ok: true;
        count: number;
        gcalError?: string | null;
        notePageId?: string | null;
        meetingId?: string | null;
        selfCheckIn?: boolean;
      }
    | { ok: false; error: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  // A Core meeting is derived from inviting the Core group (systemKey "core")
  // rather than a manual toggle — so it lands on the Core calendar automatically.
  const coreSelected = selectedGroupIds.some((gid) => groupsById.get(gid)?.systemKey === "core");

  // Prefill the Project picker when exactly one selected group is a
  // system-managed project group (see GroupOption.projectId) — still fully
  // overridable by the sender.
  useEffect(() => {
    if (!createNote || selectedGroupIds.length !== 1) return;
    const g = groupsById.get(selectedGroupIds[0]!);
    if (g?.projectId && !projectId) setProjectId(g.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupIds, createNote]);

  // Both pickers filled → derive duration; otherwise fall back to 30 min so
  // "schedule later" (no start/end yet) still produces a valid payload.
  const duration = durationMinutesBetween(startLocal, endLocal);
  const startEndValid =
    !startLocal || !endLocal || new Date(endLocal).getTime() > new Date(startLocal).getTime();
  const meetingTypeValid =
    !createNote || meetingType !== "Other" || meetingTypeLabel.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes: duration,
      };
      const rrule = repeatSpecToRRule(repeat);
      if (rrule) payload.recurrenceRule = rrule;
      if (startLocal) {
        // datetime-local has no timezone; interpret it in the browser's zone
        // and send a real ISO string with offset.
        const localDate = new Date(startLocal);
        if (!isNaN(localDate.getTime())) {
          payload.startTime = localDate.toISOString();
        }
      }
      if (organizerCalendarLinkId) {
        payload.organizerCalendarLinkId = organizerCalendarLinkId;
      }
      if (createNote) {
        payload.meetingType = meetingType;
        if (meetingType === "Other") payload.meetingTypeLabel = meetingTypeLabel.trim();
        if (projectId) payload.projectId = projectId;
      }
      if (canSetSelfCheckIn) {
        payload.attendanceMode = selfCheckIn ? "SelfCheckIn" : "Roster";
      }
      if (coreSelected) {
        payload.isCoreMeeting = true;
      }

      // If exactly one group is picked and no extra people are added, record the
      // group scope so notifications carry sourceGroupId. Otherwise submit as UserList.
      if (selectedGroupIds.length === 1 && selectedUserIds.length === 0) {
        payload.scopeType = "Group";
        payload.groupId = selectedGroupIds[0];
      } else if (resolvedParticipantIds.length > 0) {
        payload.scopeType = "UserList";
        payload.participantUserIds = resolvedParticipantIds;
      } else {
        payload.scopeType = "None";
      }

      const res = await fetch("/api/scheduled-meetings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, error: json.error ?? "Failed to create meeting" });
      } else {
        setStatus({
          ok: true,
          count: json.notifiedCount ?? 0,
          gcalError: json.gcalError ?? null,
          notePageId: json.notePageId ?? null,
          meetingId: json.meeting?.id ?? null,
          selfCheckIn,
        });
        setTitle("");
        setRepeat(NO_REPEAT);
        onStartLocalChange("");
        onEndLocalChange("");
        onChangeSelectedUserIds([]);
        onChangeSelectedGroupIds([]);
        setCreateNote(false);
        setMeetingType("Other");
        setMeetingTypeLabel("");
        setProjectId("");
        setSelfCheckIn(false);
      }
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    title.trim().length > 0 && duration > 0 && startEndValid && meetingTypeValid && !submitting;

  const fieldClass =
    "w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/40";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <section className={cn(panel, panelPad)}>
      <h2 className="font-heading font-semibold text-foreground mb-4">Create Meeting</h2>
      <form onSubmit={submit} className={cn("space-y-5", formClass)}>
        {/* Essentials */}
        <div className="space-y-3">
          <div>
            <label htmlFor="meeting-title" className={labelClass}>
              Title
            </label>
            <input
              id="meeting-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="meeting-start" className={labelClass}>
                Starts <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <DateField
                mode="datetime-local"
                value={startLocal}
                onChange={(next) => {
                  onStartLocalChange(next);
                  if (next && (!endLocal || new Date(endLocal).getTime() <= new Date(next).getTime())) {
                    const d = new Date(next);
                    d.setMinutes(d.getMinutes() + (duration > 0 ? duration : 30));
                    onEndLocalChange(toDatetimeLocal(d));
                  }
                }}
                className="w-full"
                ariaLabel="Starts"
              />
            </div>
            <div>
              <label htmlFor="meeting-end" className={labelClass}>
                Ends
              </label>
              <DateField
                mode="datetime-local"
                value={endLocal}
                min={startLocal || undefined}
                onChange={(value) => onEndLocalChange(value)}
                className="w-full"
                ariaLabel="Ends"
              />
              {!startEndValid && (
                <p className="mt-1 text-xs text-red-600">End must be after start.</p>
              )}
            </div>
          </div>
          <ParticipantPicker
            users={users}
            groups={groups}
            selectedUserIds={selectedUserIds}
            selectedGroupIds={selectedGroupIds}
            onChangeUsers={onChangeSelectedUserIds}
            onChangeGroups={onChangeSelectedGroupIds}
            usersById={usersById}
            groupsById={groupsById}
            resolvedCount={resolvedParticipantIds.length}
          />
        </div>

        {/* Secondary scheduling details — quieter, less visual weight */}
        <div className="flex flex-col gap-4 pt-1 border-t border-border">
          <div className="pt-3">
            <RepeatField
              value={repeat}
              onChange={setRepeat}
              anchorLocal={startLocal}
              labelClassName={labelClass}
              fieldClassName={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="organizer-calendar" className={labelClass}>
              Send invite from
            </label>
            {googleLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground pt-2">
                No Google calendar linked. Link one in My Availability to send Gmail invites.
              </p>
            ) : (
              <Select
                value={organizerCalendarLinkId}
                onChange={(v) => setOrganizerCalendarLinkId(v)}
                options={[
                  { value: "", label: "No invite (in-app notification only)" },
                  ...googleLinks.map((l) => ({
                    value: l.id,
                    label: l.displayName ? `${l.displayName} — ${l.externalEmail}` : l.externalEmail,
                  })),
                ]}
                buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
              />
            )}
          </div>
        </div>

        {/* Optional add-ons */}
        <div className="space-y-3 pt-1 border-t border-border">
          <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Optional
          </p>

          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <Checkbox
              checked={createNote}
              onChange={(e) => setCreateNote(e.target.checked)}
              label="Create meeting note"
            />

            {createNote && (
              <div className="pl-6 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="meeting-type" className={labelClass}>
                      Meeting type
                    </label>
                    <Select
                      value={meetingType}
                      onChange={(v) => setMeetingType(v as typeof meetingType)}
                      options={[
                        { value: "Team", label: "Team meeting" },
                        { value: "Partner", label: "Partner meeting" },
                        { value: "Other", label: "Other" },
                      ]}
                      buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
                    />
                  </div>
                  {meetingType === "Other" && (
                    <div>
                      <label htmlFor="meeting-type-label" className={labelClass}>
                        Meeting type name
                      </label>
                      <input
                        id="meeting-type-label"
                        type="text"
                        value={meetingTypeLabel}
                        onChange={(e) => setMeetingTypeLabel(e.target.value)}
                        placeholder="e.g. Partner hub meeting"
                        required
                        className={fieldClass}
                      />
                    </div>
                  )}
                  <div className={meetingType === "Other" ? "sm:col-span-2" : ""}>
                    <label htmlFor="meeting-project" className={labelClass}>
                      Project <span className="text-muted-foreground font-normal">(optional)</span>
                    </label>
                    <Select
                      value={projectId}
                      onChange={(v) => setProjectId(v)}
                      options={[
                        { value: "", label: "No project — Lab documents" },
                        ...myProjects.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {coreSelected && (
            <div className="flex items-start gap-2 rounded-md border border-accent-teal/40 bg-accent-teal/10 p-3 text-xs text-foreground">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent-teal" />
              <span>The Core group is invited, so this shows on the Core calendar.</span>
            </div>
          )}

          {canSetSelfCheckIn && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <Checkbox
                checked={selfCheckIn}
                onChange={(e) => setSelfCheckIn(e.target.checked)}
                label="Self check-in (QR)"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-sm min-w-0">
            {status?.ok === true && !status.gcalError && (
              <span className="text-green-700">
                Meeting created. Notified {status.count} participant
                {status.count === 1 ? "" : "s"}.
                {status.notePageId && (
                  <>
                    {" "}
                    {/* Not target="_blank": the desktop shell is a single
                        webview with no window to open into, so the click did
                        nothing at all. Embedded in the web workspace this opens
                        a tab; standalone it just navigates. */}
                    <a
                      href={`/documents/${status.notePageId}`}
                      onClick={(e) => {
                        if (
                          requestOpenTabIfEmbedded(
                            `/documents/${status.notePageId}`,
                            "Meeting note",
                          )
                        )
                          e.preventDefault();
                      }}
                      className="underline font-medium"
                    >
                      View meeting note
                    </a>
                  </>
                )}
                {status.selfCheckIn && !status.notePageId && status.meetingId && (
                  <>
                    {" "}
                    <a
                      href={`/calendar/check-in/${status.meetingId}`}
                      onClick={(e) => {
                        if (
                          requestOpenTabIfEmbedded(
                            `/calendar/check-in/${status.meetingId}`,
                            "Check-in",
                          )
                        )
                          e.preventDefault();
                      }}
                      className="underline font-medium"
                    >
                      Open check-in / QR
                    </a>
                  </>
                )}
              </span>
            )}
            {status?.ok === true && status.gcalError && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <div className="font-medium">
                  Meeting created, but the Google Calendar invite didn't go out.
                </div>
                <div className="text-xs mt-0.5">
                  Notified {status.count} participant{status.count === 1 ? "" : "s"} in-app.{" "}
                  {/insufficient.*scope|insufficientPermissions|invalid_grant|unauthorized/i.test(
                    status.gcalError,
                  ) ? (
                    <>
                      Your linked Google account is missing calendar-write permission.{" "}
                      <a href="/oauth/calendar/google/start" className="underline font-medium">
                        Reconnect Google Calendar
                      </a>{" "}
                      to send invites.
                    </>
                  ) : (
                    <>Details: {status.gcalError}</>
                  )}
                </div>
              </div>
            )}
            {status?.ok === false && <span className="text-red-700">{status.error}</span>}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={buttonClasses("primary", "sm")}
          >
            {submitting ? "Creating…" : "Create meeting"}
          </button>
        </div>
      </form>
    </section>
  );
}

type AddingMode = null | "user" | "group";

function ParticipantPicker({
  users,
  groups,
  selectedUserIds,
  selectedGroupIds,
  onChangeUsers,
  onChangeGroups,
  usersById,
  groupsById,
  resolvedCount,
}: {
  users: UserOption[];
  groups: GroupOption[];
  selectedUserIds: string[];
  selectedGroupIds: string[];
  onChangeUsers: (ids: string[]) => void;
  onChangeGroups: (ids: string[]) => void;
  usersById: Map<string, UserOption>;
  groupsById: Map<string, GroupOption>;
  resolvedCount: number;
}) {
  const { fieldRadius } = useOsChrome();
  const [adding, setAdding] = useState<AddingMode>(null);
  const [query, setQuery] = useState("");

  const availableUsers = users.filter((u) => !selectedUserIds.includes(u.id));
  const availableGroups = groups.filter((g) => !selectedGroupIds.includes(g.id));

  const filteredUsers = availableUsers.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      (u.daliEmail ?? "").toLowerCase().includes(q)
    );
  });
  const filteredGroups = availableGroups.filter((g) => {
    if (!query) return true;
    return g.name.toLowerCase().includes(query.toLowerCase());
  });

  function closePicker() {
    setAdding(null);
    setQuery("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-foreground inline-flex items-center gap-1">
          Participants
          <InfoTip content="Add individuals or groups. Groups marked with a team icon are dynamic — their membership resolves at invite time, so new members added after scheduling will not be included." />
        </label>
        <span className="text-xs text-muted-foreground">
          {resolvedCount} unique user{resolvedCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {selectedGroupIds.map((gid) => {
          const g = groupsById.get(gid);
          if (!g) return null;
          return (
            <Tooltip key={`g:${gid}`} content={`${g.memberIds.length} member${g.memberIds.length === 1 ? "" : "s"}`}>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                <UsersRound className="w-3 h-3" />
                {g.name}
                <button
                  type="button"
                  onClick={() => onChangeGroups(selectedGroupIds.filter((x) => x !== gid))}
                  aria-label={`Remove ${g.name}`}
                  className="hover:text-blue-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </Tooltip>
          );
        })}
        {selectedUserIds.map((uid) => {
          const u = usersById.get(uid);
          if (!u) return null;
          return (
            <span
              key={`u:${uid}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
            >
              {userLabel(u)}
              <button
                type="button"
                onClick={() => onChangeUsers(selectedUserIds.filter((x) => x !== uid))}
                aria-label={`Remove ${userLabel(u)}`}
                className="hover:text-purple-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}

        {adding === null && (
          <>
            <button
              type="button"
              onClick={() => setAdding("user")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Plus className="w-3 h-3" /> Add user
            </button>
            <button
              type="button"
              onClick={() => setAdding("group")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Plus className="w-3 h-3" /> Add user group
            </button>
          </>
        )}
      </div>

      {adding !== null && (
        <div className={cn("mt-2 border border-border bg-background p-2 space-y-2", fieldRadius)}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {adding === "user" ? "Pick a user" : "Pick a user group"}
            </span>
            <button
              type="button"
              onClick={closePicker}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={adding === "user" ? "Search by name or email…" : "Search by group name…"}
            className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto">
            {adding === "user" ? (
              filteredUsers.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No users match.</p>
              ) : (
                filteredUsers.slice(0, 50).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      onChangeUsers([...selectedUserIds, u.id]);
                      closePicker();
                    }}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded"
                  >
                    {userLabel(u)}
                  </button>
                ))
              )
            ) : filteredGroups.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                No groups match.{" "}
                <a href="/members/groups" className="underline">
                  Create one
                </a>
                .
              </p>
            ) : (
              filteredGroups.slice(0, 50).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onChangeGroups([...selectedGroupIds, g.id]);
                    closePicker();
                  }}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded flex justify-between items-center"
                >
                  <span>{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleWeekGrid({
  participantIds,
  showingSelfOnly = false,
  users,
  workingHours,
  workingHoursEnabled,
  durationMinutes,
  timezone,
  weekStartIso,
  weekEndIso,
  onSelectRange,
  selectedStartLocal,
  selectedEndLocal,
}: {
  participantIds: string[];
  // True when the caller is rendering the current user's own availability
  // (no participants picked yet) — used to relabel the header / legend.
  showingSelfOnly?: boolean;
  users: UserOption[];
  // The viewer's own working hours, used to stripe out non-working hours.
  workingHours: WhDay[];
  // False when the Working Hours feature is off — suppresses the stripes.
  workingHoursEnabled: boolean;
  durationMinutes: number;
  timezone: string;
  weekStartIso: string;
  weekEndIso: string;
  onSelectRange?: (startLocal: string, endLocal: string) => void;
  selectedStartLocal?: string;
  selectedEndLocal?: string;
}) {
  const { panel } = useOsChrome();
  const [data, setData] = useState<GroupAvailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set (via the participant roster below the toolbar), the grid overlays
  // just this one participant's free intervals so you can read one person's
  // availability at a glance instead of the aggregate gradient.
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  // Bumped to force the fetch effect to re-run without changing inputs (manual
  // refresh button + tab-focus refresh).
  const [refreshKey, setRefreshKey] = useState(0);
  const revalidator = useRevalidator();
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    revalidator.revalidate();
  };
  useRefreshOnFocus(refresh);

  // Stable key so the effect only re-fires on a real change. participantIds
  // itself is a fresh array each render — using it as a dep would make this
  // effect cancel+restart every render, leaving "Loading…" stuck on the screen.
  const participantKey = participantIds.slice().sort().join(",");

  useEffect(() => {
    const ids = participantKey ? participantKey.split(",") : [];
    if (ids.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // durationMinutes is intentionally omitted: it only affects the server's
    // ≥-duration match windows (data.days), which this grid never reads — the
    // gradient and slot breakdown are built from per-user free intervals. Re-
    // fetching on every drag would just flash "Loading availability…".
    fetch("/api/calendar/group-availability", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: ids,
        weekStartIso,
        weekEndIso,
        durationMinutes,
        timezone,
      }),
    })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(json.error ?? "Failed to load availability");
          setData(null);
        } else {
          setData(json as GroupAvailResponse);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantKey, weekStartIso, weekEndIso, timezone, refreshKey]);

  // Build the 7-day axis from the week window so empty days still render.
  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      dayOfWeek: dayDate.getUTCDay(),
      num: dayDate.getUTCDate(),
      dateUtc: dayDate,
    };
  });

  // When2Meet-style availability gradient: each 15-min cell is tinted by the
  // fraction of participants free at that time. We render the gradient as the
  // background layer, leaving the Busy blocks out entirely — free vs. busy is
  // already encoded in the cell's saturation.
  const eventsByDay: Record<number, EventBlock[]> = {};
  const totalParticipants = participantIds.length;
  const CELL_HOURS = SNAP_HOURS; // 10-minute availability cells
  const GRID_START_H = HOURS[0];
  const GRID_END_H = HOURS[HOURS.length - 1] + 1;
  const CELLS_PER_DAY = Math.round((GRID_END_H - GRID_START_H) / CELL_HOURS);

  // Pre-parse each participant's free intervals into sorted (startMs, endMs)
  // tuples for fast containment checks below.
  const perUserFree: { startMs: number; endMs: number }[][] = data
    ? data.perUser.map((u) =>
        u.free
          .map((iv) => ({
            startMs: new Date(iv.startIso).getTime(),
            endMs: new Date(iv.endIso).getTime(),
          }))
          .sort((a, b) => a.startMs - b.startMs),
      )
    : [];

  function freeCountAtCell(cellStartMs: number, cellEndMs: number): number {
    let n = 0;
    for (const intervals of perUserFree) {
      let covered = false;
      for (const iv of intervals) {
        if (iv.endMs <= cellStartMs) continue;
        if (iv.startMs > cellStartMs) break;
        if (iv.startMs <= cellStartMs && iv.endMs >= cellEndMs) {
          covered = true;
        }
        break;
      }
      if (covered) n += 1;
    }
    return n;
  }

  // Build per-day cell tints. Each entry is { startHour, durationHours, alpha }
  // ready to render as a colored absolute-positioned block.
  type CellTint = { startHour: number; alpha: number };
  const tintsByColIdx: CellTint[][] = data
    ? days.map((d, colIdx) => {
        const cells: CellTint[] = [];
        const dayStartMs = weekStart.getTime() + colIdx * 86_400_000;
        for (let i = 0; i < CELLS_PER_DAY; i++) {
          const hour = GRID_START_H + i * CELL_HOURS;
          const cellStartMs = dayStartMs + hour * 3_600_000;
          const cellEndMs = cellStartMs + CELL_HOURS * 3_600_000;
          const k = freeCountAtCell(cellStartMs, cellEndMs);
          if (k === 0) continue;
          const alpha = totalParticipants > 0 ? k / totalParticipants : 0;
          cells.push({ startHour: hour, alpha });
        }
        // Reference d so the linter doesn't complain (we may use it later).
        void d;
        return cells;
      })
    : [];

  // Per-day free blocks for the single hovered participant. When set, the grid
  // paints these (solid green) instead of the aggregate gradient so the user
  // can read one person's availability at a glance. Each interval is clamped to
  // the visible [GRID_START_H, GRID_END_H) window of its day column.
  const hoveredFreeByColIdx: { startHour: number; durationHours: number }[][] =
    data && hoveredUserId
      ? (() => {
          const free = data.perUser.find((u) => u.userId === hoveredUserId)?.free ?? [];
          const ivs = free
            .map((iv) => ({
              startMs: new Date(iv.startIso).getTime(),
              endMs: new Date(iv.endIso).getTime(),
            }))
            .sort((a, b) => a.startMs - b.startMs);
          return days.map((_, colIdx) => {
            const dayStartMs = weekStart.getTime() + colIdx * 86_400_000;
            const winStartMs = dayStartMs + GRID_START_H * 3_600_000;
            const winEndMs = dayStartMs + GRID_END_H * 3_600_000;
            const blocks: { startHour: number; durationHours: number }[] = [];
            for (const iv of ivs) {
              const s = Math.max(iv.startMs, winStartMs);
              const e = Math.min(iv.endMs, winEndMs);
              if (e <= s) continue;
              blocks.push({
                startHour: (s - dayStartMs) / 3_600_000,
                durationHours: (e - s) / 3_600_000,
              });
            }
            return blocks;
          });
        })()
      : [];

  // Compute the selected-slot overlay (rendered separately so we can show a
  // hover popover with attending vs. unavailable participants).
  type SelectedSlot = {
    dow: number;
    startHour: number;
    duration: number;
    available: UserOption[];
    unavailable: UserOption[];
  };
  let selectedSlot: SelectedSlot | null = null;
  if (selectedStartLocal && selectedEndLocal && data && participantIds.length > 0) {
    const sd = new Date(selectedStartLocal);
    const ed = new Date(selectedEndLocal);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed.getTime() > sd.getTime()) {
      const sameDay = sd.toDateString() === ed.toDateString();
      const dow = sd.getDay();
      const startHour = sd.getHours() + sd.getMinutes() / 60;
      const endHour = ed.getHours() + ed.getMinutes() / 60;
      const duration = sameDay ? endHour - startHour : 24 - startHour;
      if (duration > 0) {
        // A user is "available" if their free intervals cover the entire
        // [sd, ed] window. We allow the union of multiple free intervals.
        const slotStartMs = sd.getTime();
        const slotEndMs = ed.getTime();
        const usersById = new Map(users.map((u) => [u.id, u]));
        const perUserById = new Map(data.perUser.map((p) => [p.userId, p]));
        const available: UserOption[] = [];
        const unavailable: UserOption[] = [];
        for (const uid of participantIds) {
          const user = usersById.get(uid) ?? {
            id: uid,
            firstName: uid,
            lastName: "",
            daliEmail: null,
          };
          const free = perUserById.get(uid)?.free ?? [];
          // Build the contiguous free-coverage over [slotStartMs, slotEndMs].
          // Sort & merge first, then walk.
          const sortedFree = free
            .map((iv) => ({ s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }))
            .sort((a, b) => a.s - b.s);
          let cursor = slotStartMs;
          for (const iv of sortedFree) {
            if (iv.e <= cursor) continue;
            if (iv.s > cursor) break;
            cursor = Math.max(cursor, iv.e);
            if (cursor >= slotEndMs) break;
          }
          if (cursor >= slotEndMs) available.push(user);
          else unavailable.push(user);
        }
        selectedSlot = { dow, startHour, duration, available, unavailable };
      }
    }
  }

  return (
    <section className={cn(panel, "p-4 flex flex-col")}>
      <WeekToolbar
        monthLabel={"Schedule preview"}
        weekStartIso={weekStartIso}
        onRefresh={refresh}
        refreshing={loading || revalidator.state !== "idle"}
        legend={
          showingSelfOnly
            ? [{ swatch: availabilityTint(1), label: "Free" }]
            : [
                { swatch: availabilityTint(0.33), label: "Few free" },
                { swatch: availabilityTint(0.66), label: "Some free" },
                { swatch: availabilityTint(1), label: "All free" },
              ]
        }
      />
      {participantIds.length === 0 ? null : (
        <>
          {loading && (
            <div className="px-4 py-1 text-xs text-muted-foreground">Loading availability…</div>
          )}
          {error && (
            <div className="px-4 py-2 text-xs text-red-700">{error}</div>
          )}
          {!showingSelfOnly && data && participantIds.length > 0 && (
            <div className="flex items-center gap-1 px-2 pt-1">
              <span className="text-xs text-muted-foreground">Hover a name to see their free times.</span>
              <InfoTip content="The grid shades each slot by how many participants are free at that time. The darker the green, the more people are available. Hover a name below to highlight just their free intervals. Free/busy is fetched from each person's working-hours settings and linked Google Calendar." />
            </div>
          )}
          {!showingSelfOnly && data && participantIds.length > 0 && (
            <ParticipantAvailabilityRoster
              participantIds={participantIds}
              users={users}
              hoveredUserId={hoveredUserId}
              onHover={setHoveredUserId}
            />
          )}
          <WeekGrid
            days={days}
            eventsByDay={eventsByDay}
            showSubHourGrid
            timezone={timezone}
            backgroundLayer={(dayIdx) => (
              <>
                {hoveredUserId ? (
                  // One participant's own free intervals (solid green), so the
                  // user can read that person's availability at a glance.
                  (hoveredFreeByColIdx[dayIdx] ?? []).map((b, i) => (
                    <BlockBlock
                      key={`hover-${i}`}
                      topHour={GRID_START_H}
                      startHour={b.startHour}
                      duration={b.durationHours}
                      style={{ backgroundColor: availabilityTint(1) }}
                    />
                  ))
                ) : (
                  /* Aggregate gradient. Drawn first so the stripes layer on top. */
                  (tintsByColIdx[dayIdx] ?? []).map((t, i) => (
                    <BlockBlock
                      key={`tint-${i}`}
                      topHour={GRID_START_H}
                      startHour={t.startHour}
                      duration={CELL_HOURS}
                      style={{ backgroundColor: availabilityTint(t.alpha) }}
                    />
                  ))
                )}
                {workingHoursStripeLayer(workingHours, days[dayIdx].dayOfWeek, {
                  enabled: workingHoursEnabled,
                })}
              </>
            )}
            overlayLayer={(dayIdx) => {
              if (!selectedSlot) return null;
              if (days[dayIdx]?.dayOfWeek !== selectedSlot.dow) return null;
              return (
                <SelectedSlotBlock
                  startHour={selectedSlot.startHour}
                  duration={selectedSlot.duration}
                  available={selectedSlot.available}
                  unavailable={selectedSlot.unavailable}
                />
              );
            }}
            onDayPointerSelect={
              onSelectRange
                ? (dayIdx, startHour, endHour) => {
                    const day = days[dayIdx];
                    if (!day) return;
                    onSelectRange(
                      dayHourToLocal(day.dateUtc, startHour),
                      dayHourToLocal(day.dateUtc, endHour),
                    );
                  }
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}

// Roster of the picked participants. Hovering a name asks the grid to overlay
// just that person's free intervals (see hoveredUserId in ScheduleWeekGrid).
function ParticipantAvailabilityRoster({
  participantIds,
  users,
  hoveredUserId,
  onHover,
}: {
  participantIds: string[];
  users: UserOption[];
  hoveredUserId: string | null;
  onHover: (userId: string | null) => void;
}) {
  const usersById = new Map(users.map((u) => [u.id, u]));
  return (
    <div className="px-2 pb-4 flex flex-wrap items-center gap-1.5">
      {participantIds.map((uid) => {
        const u = usersById.get(uid) ?? {
          id: uid,
          firstName: uid,
          lastName: "",
          daliEmail: null,
        };
        const active = hoveredUserId === uid;
        return (
          <button
            key={uid}
            type="button"
            onMouseEnter={() => onHover(uid)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(uid)}
            onBlur={() => onHover(null)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-accent-green text-[hsl(203_38%_18%)]"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {userLabel(u)}
          </button>
        );
      })}
    </div>
  );
}

function SelectedSlotBlock({
  startHour,
  duration,
  available,
  unavailable,
}: {
  startHour: number;
  duration: number;
  available: UserOption[];
  unavailable: UserOption[];
}) {
  const [open, setOpen] = useState(false);
  // Anchor the popover to the block's real on-screen rect (state, not a plain
  // ref, so the portal re-renders the moment the node attaches).
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const total = available.length + unavailable.length;
  const top = (startHour - HOURS[0]) * HOUR_PX;
  const height = duration * HOUR_PX;
  return (
    <div
      ref={setAnchorEl}
      className="absolute left-0 right-0 z-30 cursor-help border-2 border-accent-coral bg-accent-coral/10 rounded-sm"
      style={{ top, height }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="m-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold rounded-sm shadow-sm bg-accent-coral text-white">
        {available.length}/{total}
      </div>
      {open && (
        <SlotAttendeePopover
          anchorEl={anchorEl}
          available={available}
          unavailable={unavailable}
        />
      )}
    </div>
  );
}

// The attendee breakdown for a selected slot. Rendered in a <body> portal so
// the grid's overflow-hidden / column edges can't clip it, and positioned
// `fixed` against the slot block's screen rect — preferring the right side but
// flipping left and clamping vertically to stay fully on-screen. Anchoring off
// the measured rect (in a layout effect) keeps it from jumping when the
// availability data refetches under it.
function SlotAttendeePopover({
  anchorEl,
  available,
  unavailable,
}: {
  anchorEl: HTMLElement | null;
  available: UserOption[];
  unavailable: UserOption[];
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const total = available.length + unavailable.length;

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      const a = anchorEl.getBoundingClientRect();
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const gap = 8;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Prefer the right of the block; flip left if it would overflow.
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      // Top-align with the block when the card fits below, else lift it so the
      // bottom stays on-screen.
      let top = a.top + ch + margin <= vh ? a.top : vh - ch - margin;
      top = Math.max(margin, top);
      setPos((prev) =>
        prev && prev.left === left && prev.top === top ? prev : { left, top },
      );
    };
    place();
    const ro = new ResizeObserver(place);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl]);

  if (typeof document === "undefined") return null;

  // First paint (before the layout effect measures): estimate a spot beside the
  // anchor so it renders next to the block, not at (0,0). Hidden via opacity
  // until measured to avoid a one-frame flash at the estimate, then clamped.
  const measured = pos != null;
  let left = pos?.left ?? 0;
  let top = pos?.top ?? 0;
  if (!measured) {
    const a = anchorEl?.getBoundingClientRect();
    if (a) {
      const CARD_W = 224; // matches w-56
      const gap = 8;
      const margin = 8;
      left =
        a.right + gap + CARD_W + margin > window.innerWidth
          ? a.left - gap - CARD_W
          : a.right + gap;
      left = Math.max(margin, left);
      top = Math.max(margin, a.top);
    }
  }

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 w-56 rounded-md shadow-lg p-2 text-xs"
      style={{
        left,
        top,
        visibility: measured ? "visible" : "hidden",
        backgroundColor: "var(--color-card)",
        color: "var(--color-foreground)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="font-semibold mb-1 text-foreground">
        {available.length} of {total} can attend
      </div>
      {available.length > 0 && (
        <div className="mb-1.5">
          <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
            Available
          </div>
          <ul className="space-y-0.5">
            {available.map((u) => (
              <li key={u.id} className="text-green-700 dark:text-green-400">
                {userLabel(u)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unavailable.length > 0 && (
        <div>
          <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
            Busy
          </div>
          <ul className="space-y-0.5">
            {unavailable.map((u) => (
              <li key={u.id} className="text-red-700 dark:text-red-400">
                {userLabel(u)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>,
    document.body,
  );
}

