import { Link, redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
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
} from "lucide-react";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { fullName } from "~/lib/display";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import {
  canViewForms,
  currentTermMemberWhere,
  getUserRoleInstances,
  resolveRoleRef,
  type RoleInstance,
} from "~/lib/roles";
import { CalendarActionSchema, validateTimeEntryRange } from "~/lib/calendar-schemas";
import { syncManualBlockTimeEntry } from "~/lib/time-entry-sync";
import { fetchBusyEvents, listCalendarsForLink } from "~/lib/google-calendar";
import { getZonedHourFraction, getZonedYMD, resolveUserTimeZone, zonedDayStartUtc } from "~/lib/timezone";
import type { Route } from "./+types/calendar";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { Tooltip } from "~/components/ui/IconButton";
import { buttonClasses } from "~/components/ui/Button";
import { RsvpButtons } from "~/components/RsvpButtons";
import { CustomHiresManager } from "~/calendar/components/CustomHiresManager";

// Underline subnav sits flush under the workspace tab bar (see layout embed padding).
export const handle = {
  areaPills: true,
  docKey: "calendar",
  docTitle: "Calendar",
};

const DEFAULT_BUFFER_MIN = 15;
const DEFAULT_WORK_START_MIN = 9 * 60;
const DEFAULT_WORK_END_MIN = 17 * 60;

type WhSegment = {
  id: string;
  startMinute: number;
  endMinute: number;
  location: "InPerson" | "Remote";
};

type WhDay = {
  dayOfWeek: number;
  segments: WhSegment[];
};

type ManualBlockDTO = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  recurrenceRule: string | null;
  isWork: boolean;
  assignmentType: RoleInstance["assignmentType"] | null;
  roleRefId: string | null;
};

type SubCalendarDTO = {
  id: string;
  summary: string;
  primary: boolean;
  color: string | null;
  enabled: boolean;
};

type CalendarLinkDTO = {
  id: string;
  provider: "Google" | "Outlook";
  externalEmail: string;
  displayName: string | null;
  enabled: boolean;
  primary: boolean;
  syncError: string | null;
  // null when the upstream list call failed; the UI shows a degraded card.
  subCalendars: SubCalendarDTO[] | null;
};

type GroupOption = {
  id: string;
  name: string;
  // Resolved members for this group at load time (either explicit static list
  // or the resolved Dynamic membership). The picker treats both uniformly.
  memberIds: string[];
  // Derived from dynamicQuery ("project:<id>") for system-managed project
  // groups (see ensureProjectGroup in ~/lib/groups.ts). Lets the Schedule
  // Meeting form prefill the Project picker when such a group is selected.
  projectId: string | null;
};

type UserOption = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
};

type ProjectOption = { id: string; name: string };

type TimeEntryDTO = {
  id: string;
  source: "Meeting" | "Manual" | "Block";
  scheduledMeetingId: string | null;
  manualBlockId: string | null;
  meetingNotePageId: string | null;
  assignmentType: RoleInstance["assignmentType"] | null;
  roleRefId: string | null;
  projectId: string | null;
  date: string;
  hours: number;
  note: string | null;
  // Set when this entry has a precise time range (meeting-sourced, or a
  // manual entry created by dragging on the Timesheet week grid). Null for
  // entries added via the plain date+hours form — those don't render as a
  // grid block.
  startTime: string | null;
  endTime: string | null;
};

type LoaderData = {
  timezone: string;
  defaultEventBufferMin: number;
  workingHours: WhDay[];
  // True once the user has saved any working-hours state (even "all off"). The
  // client uses this to (a) show the master toggle as off for brand-new users
  // and (b) seed the full week on first edit so unsaved defaults aren't lost.
  hasPersistedWorkingHours: boolean;
  manualBlocks: ManualBlockDTO[];
  calendarLinks: CalendarLinkDTO[];
  weekStartIso: string;
  weekEndIso: string;
  // External (Google) events for display: real titles + per-calendar colour,
  // straight from events.list (not the merged availability intervals, which
  // drop titles). Manual blocks render separately from data.manualBlocks.
  externalEvents: {
    startIso: string;
    endIso: string;
    title: string;
    color: string | null;
    description?: string;
    location?: string;
  }[];
  ingestionError: string | null;
  groups: GroupOption[];
  users: UserOption[];
  currentUserId: string;
  myProjects: ProjectOption[];
  myRoles: RoleInstance[];
  timeEntries: TimeEntryDTO[];
  /** Core, Admin, or Instructor — can enable Self check-in (QR) on meetings. */
  canSetSelfCheckIn: boolean;
  // Scheduled meetings the viewer was invited to whose start falls in the
  // visible week. Rendered as RSVP-able blocks on the My Availability grid so
  // Accept/Maybe/Decline is available in the calendar, not just in tasks.
  // notificationId targets the RSVP endpoint (RSVP lives on the MeetingInvite
  // Notification, not on MeetingAttendance).
  meetingInvites: MeetingInviteDTO[];
};

type MeetingInviteDTO = {
  notificationId: string;
  meetingId: string;
  title: string;
  startIso: string;
  endIso: string;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
  notePageId: string | null;
};

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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const userId = auth.user.sub;

  // Participant picker is for scheduling with current lab members — exclude
  // applicants, partners, and alumni who happen to still have a User row.
  const memberWhere = await currentTermMemberWhere();

  const [
    settings,
    userRow,
    whRows,
    blocks,
    links,
    groups,
    users,
    myProjects,
    myRoles,
    timeEntryRows,
    canSetSelfCheckIn,
  ] = await Promise.all([
      prisma.userAvailabilitySettings.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
      prisma.workingHoursDay.findMany({ where: { userId } }),
      prisma.manualBlock.findMany({
        where: { userId },
        orderBy: { startTime: "asc" },
        take: 200,
      }),
      prisma.userCalendarLink.findMany({
        where: { userId },
        orderBy: { linkedAt: "asc" },
      }),
      listVisibleGroupsForUser(userId).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          memberIds: r.memberIds,
          projectId: r.dynamicQuery?.startsWith("project:")
            ? r.dynamicQuery.slice("project:".length)
            : null,
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
      getUserRoleInstances(userId),
      prisma.timeEntry.findMany({
        where: { userId },
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
      // Same gate as Forms: Core, Admin, or Instructor.
      canViewForms(userId),
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
  const weekStartParam = url.searchParams.get("weekStart");
  let anchor: Date | undefined;
  if (weekStartParam) {
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStartParam);
    if (ymdMatch) {
      const y = Number(ymdMatch[1]);
      const m = Number(ymdMatch[2]);
      const d = Number(ymdMatch[3]);
      anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    } else {
      const parsed = new Date(weekStartParam);
      if (!isNaN(parsed.getTime())) anchor = parsed;
    }
  }
  const { start: weekStart, end: weekEnd } = weekWindow(timezone, anchor);

  // Fetch external busy + sub-calendar lists in parallel. Don't fail the page
  // if a single link errors — surface the error on the link card.
  let ingestionError: string | null = null;
  const [externalBusyRaw, calendarLinks, inviteRows] = await Promise.all([
    fetchBusyEvents(userId, weekStart, weekEnd).catch((err) => {
      ingestionError = err instanceof Error ? err.message : "Failed to fetch external busy";
      return [] as Awaited<ReturnType<typeof fetchBusyEvents>>;
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
        try {
          const items = await listCalendarsForLink(l.id);
          const enabledSet = new Set(l.subCalendarIds);
          // When subCalendarIds is empty, treat the primary as the only one in use.
          const subCalendars: SubCalendarDTO[] = items.map((it) => ({
            id: it.id,
            summary: it.summary,
            primary: it.primary === true,
            color: it.backgroundColor ?? null,
            enabled:
              l.subCalendarIds.length === 0 ? it.primary === true : enabledSet.has(it.id),
          }));
          return { ...base, subCalendars };
        } catch {
          return { ...base, subCalendars: null };
        }
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
          selectedAt: { gte: weekStart, lt: weekEnd },
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
            notePage: { select: { id: true } },
          },
        },
      },
    }),
  ]);

  const meetingInvites: MeetingInviteDTO[] = inviteRows.flatMap((n) => {
    const m = n.scheduledMeeting;
    if (!m?.selectedAt) return [];
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);
    return [
      {
        notificationId: n.id,
        meetingId: m.id,
        title: m.title,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        rsvp: n.rsvp,
        notePageId: m.notePage?.id ?? null,
      },
    ];
  });

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
    })),
    calendarLinks,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    externalEvents: externalBusyRaw.map((e) => ({
      startIso: e.start,
      endIso: e.end,
      title: e.title ?? "Busy",
      color: e.color ?? null,
      description: e.description,
      location: e.location,
    })),
    ingestionError,
    groups,
    users,
    currentUserId: userId,
    myProjects,
    myRoles,
    canSetSelfCheckIn,
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
  };
  return data;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.type === "applicant")
    return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());

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
    default:
      return raw;
  }
}

type Tab = "availability" | "schedule" | "timesheet";

const CALENDAR_TAB_STORAGE_KEY = "dali:calendar:tab";
const AVAILABILITY_SIDEBAR_COLLAPSED_KEY = "dali:calendar:availability:sidebar-collapsed";

export default function CalendarPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  // Persist the active tab in sessionStorage so navigating away and back
  // (or the workspace iframe re-mounting on tab focus) restores where the
  // user left off rather than always snapping back to Availability.
  const [tab, setTab] = useState<Tab>(() => {
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
    <div className="flex flex-col gap-5">
      <UnderlineTabButtons
        label="Calendar"
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
  return (
    <div
      className={`grid grid-cols-1 gap-6 lg:h-[max(calc(100vh-9rem),56rem)] lg:min-h-0 px-3 pt-2 ${
        sidebarCollapsed ? "lg:grid-cols-[3rem_1fr]" : "lg:grid-cols-[400px_1fr]"
      }`}
    >
      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="hidden lg:flex lg:flex-col lg:items-center lg:min-h-0 rounded-lg border border-border py-3 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Expand availability settings"
          title="Expand settings"
        >
          <PanelLeftOpen className="h-5 w-5 shrink-0" />
        </button>
      ) : (
        <aside className="flex flex-col gap-6 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-6 lg:min-h-0">
          <header className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-heading text-2xl font-bold text-foreground">Availability</h1>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="hidden lg:inline-flex shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Collapse availability settings"
              title="Collapse settings"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </header>
          <CalendarIntegrationsCard links={data.calendarLinks} ingestionError={data.ingestionError} />
          <WorkingHoursCard
            workingHours={data.workingHours}
            hasPersisted={data.hasPersistedWorkingHours}
          />
          <EventBuffersCard bufferMin={data.defaultEventBufferMin} />
          <ManualBlocksCard blocks={data.manualBlocks} timezone={data.timezone} />
        </aside>
      )}
      <div className="lg:overflow-hidden lg:min-h-0">
        <AvailabilityWeekGrid data={data} enableDragCreate />
      </div>
    </div>
  );
}

function CalendarIntegrationsCard({
  links,
  ingestionError,
}: {
  links: CalendarLinkDTO[];
  ingestionError: string | null;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          Calendar Integrations
        </h2>
        {/* `<a target="_top">` — Google's auth page sends X-Frame-Options: DENY, so
            it can't render inside the workspace iframe. Break out to the top window. */}
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
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
      <div className="flex flex-col gap-3">
        {links.length === 0 && (
          <div className="bg-card border border-border shadow-brand-1 rounded-md p-3 text-xs text-muted-foreground">
            No external calendars connected. Click <em>Add Google Account</em> above to link one.
          </div>
        )}
        {links.map((l) => (
          <CalendarLinkBlock key={l.id} link={l} />
        ))}
      </div>
    </section>
  );
}

function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const removeFetcher = useFetcher();
  return (
    <div className="bg-card border border-border shadow-brand-1 border-l-4 border-l-accent-teal rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-accent-teal/10">
        <div className="flex items-center gap-2 min-w-0">
          <GoogleIcon />
          <span className="font-semibold text-sm text-foreground truncate">
            {link.displayName ?? link.externalEmail}
          </span>
        </div>
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
      <div className="px-3 py-3 flex flex-col gap-2">
        {link.syncError && (
          <div className="text-[11px] text-destructive">Sync error: {link.syncError}</div>
        )}
        <p className="text-xs text-muted-foreground">
          Select which calendars should block your availability:
        </p>
        {link.subCalendars === null ? (
          <div className="text-xs text-muted-foreground italic">
            Couldn't load this account's calendars.
          </div>
        ) : link.subCalendars.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">No calendars found.</div>
        ) : (
          link.subCalendars.map((cal) => (
            <SubCalendarRow key={cal.id} linkId={link.id} cal={cal} />
          ))
        )}
      </div>
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
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Clock className="w-4 h-4 text-accent-coral" />
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
                <button
                  type="submit"
                  aria-label="Reset working hours to defaults"
                  title="Reset to defaults"
                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </resetFetcher.Form>
            </>
          )}
          {/* Master on/off switch */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Working hours enabled"
            onClick={enabled ? turnOff : turnOn}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              enabled ? "bg-accent-coral" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
      {enabled && (
        <div className="bg-card border border-border shadow-brand-1 rounded-md p-3 flex flex-col gap-2">
          {workingHours.map((d) => (
            <DayRow key={d.dayOfWeek} day={d} allDays={workingHours} />
          ))}
        </div>
      )}
    </section>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
                <button
                  type="button"
                  onClick={() => removeSegment(idx)}
                  aria-label={`Remove ${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1}`}
                  title="Remove segment"
                  className="p-1 mr-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
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
        className="w-[88px] pl-2 pr-6 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
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
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground mb-3">
        <Shield className="w-4 h-4 text-accent-coral" />
        Event Buffers
      </h2>
      <div className="bg-card border border-border shadow-brand-1 rounded-md p-3">
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                fetcher.submit(
                  { intent: "set-event-buffer", defaultEventBufferMin: String(o.value) },
                  { method: "post" },
                )
              }
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedMin === o.value
                  ? "bg-accent-coral text-white"
                  : "bg-background text-foreground border border-border hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {selectedMin === 0
            ? "No buffer will be added between events."
            : `A ${selectedMin}-minute buffer will be added before and after every event.`}
        </p>
      </div>
    </section>
  );
}

function ManualBlocksCard({ blocks, timezone }: { blocks: ManualBlockDTO[]; timezone: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarIcon className="w-4 h-4 text-accent-coral" />
          Manual Blocks
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
        >
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? "Cancel" : "Add Block"}
        </button>
      </div>
      {adding && <AddManualBlockForm onDone={() => setAdding(false)} />}
      <div className="flex flex-col gap-2">
        {blocks.length === 0 && !adding && (
          <div className="text-xs text-muted-foreground italic">No manual blocks.</div>
        )}
        {blocks.map((b) => (
          <ManualBlockRow key={b.id} block={b} timezone={timezone} />
        ))}
      </div>
    </section>
  );
}

function AddManualBlockForm({ onDone }: { onDone: () => void }) {
  const fetcher = useFetcher();
  const [repeats, setRepeats] = useState<Repeats>("none");
  return (
    <fetcher.Form
      method="post"
      onSubmit={() => {
        // Optimistically close the form; the loader revalidation will reveal the new row.
        queueMicrotask(onDone);
      }}
      className="bg-card border border-border shadow-brand-1 rounded-md p-3 mb-2 flex flex-col gap-2"
    >
      <input type="hidden" name="intent" value="add-manual-block" />
      <input
        name="title"
        placeholder="Title (e.g. Dentist)"
        required
        className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
      />
      <div className="flex gap-2">
        <label className="flex-1 min-w-0 text-xs text-muted-foreground flex flex-col gap-1">
          Start
          <input
            type="datetime-local"
            name="startTimeLocal"
            required
            className="w-full min-w-0 px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
            onChange={(e) => {
              const dt = e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : "";
              const hidden = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="startTime"]');
              if (hidden) hidden.value = dt;
            }}
          />
          <input type="hidden" name="startTime" />
        </label>
        <label className="flex-1 min-w-0 text-xs text-muted-foreground flex flex-col gap-1">
          End
          <input
            type="datetime-local"
            name="endTimeLocal"
            required
            className="w-full min-w-0 px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
            onChange={(e) => {
              const dt = e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : "";
              const hidden = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="endTime"]');
              if (hidden) hidden.value = dt;
            }}
          />
          <input type="hidden" name="endTime" />
        </label>
      </div>
      <label className="text-xs text-muted-foreground flex flex-col gap-1">
        Repeats
        <select
          value={repeats}
          onChange={(e) => setRepeats(e.target.value as Repeats)}
          className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
        >
          {REPEATS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {/* The action reads `recurrenceRule` as an RRULE string; derive it from
          the friendly Repeats choice so non-technical users never see RRULE. */}
      <input type="hidden" name="recurrenceRule" value={repeatsToRRule(repeats) ?? ""} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1 text-xs font-semibold rounded-md bg-accent-coral text-white hover:bg-accent-coral/90"
        >
          Add
        </button>
      </div>
    </fetcher.Form>
  );
}

function ManualBlockRow({ block, timezone }: { block: ManualBlockDTO; timezone: string }) {
  const fetcher = useFetcher();
  const removing = fetcher.state !== "idle";
  return (
    <div
      className={`bg-card border border-border shadow-brand-1 border-l-4 border-l-accent-coral rounded-md px-3 py-2 flex items-start justify-between ${
        removing ? "opacity-50" : ""
      }`}
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

function formatBlockRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} · ${t(start)} – ${t(end)}`;
}

/* ------------------------------------------------------------------ */
/* Week grids                                                          */
/* ------------------------------------------------------------------ */

function shiftWeekParam(weekStartIso: string, weeks: number): string {
  const d = new Date(weekStartIso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  // YYYY-MM-DD is enough — the loader snaps to the Sunday of that week.
  return d.toISOString().slice(0, 10);
}

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
  // Use URL-relative resolution so "?weekStart=…" stays on /calendar instead of
  // bubbling up to the parent route (which would land on /).
  const prev = `?weekStart=${shiftWeekParam(weekStartIso, -1)}`;
  const next = `?weekStart=${shiftWeekParam(weekStartIso, 1)}`;
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg font-bold text-foreground">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Link
            to={prev}
            relative="path"
            aria-label="Previous week"
            preventScrollReset
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            to="?"
            relative="path"
            preventScrollReset
            className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
          >
            Today
          </Link>
          <Link
            to={next}
            relative="path"
            aria-label="Next week"
            preventScrollReset
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh availability"
              title="Refresh availability"
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Visible hour rows: the full day, midnight through 11pm (grid bottom edge is
// midnight). Every downstream bound derives from HOURS[0] / last+1.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_PX = 54;
// Grid is snapped/subdivided into 10-minute cells.
const SUBDIVISIONS_PER_HOUR = 6; // 60 / 10
const SNAP_HOURS = 1 / SUBDIVISIONS_PER_HOUR; // 10 minutes as a fraction of an hour

// Refetch when the tab regains focus (visibilitychange covers tab switches,
// focus covers window-level focus on browsers that don't fire visibilitychange
// for window blur). Used so external Google Calendar edits show up without a
// manual reload.
function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
}

// Ticking "current time" used to draw the now-line. Returns null on the first
// render so SSR and the initial client paint agree (no hydration mismatch),
// then fills in after mount and re-ticks every `intervalMs`.
function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
  for (const inv of data.meetingInvites) {
    const style = meetingBlockStyle(inv.rsvp);
    placeBlock(inv.startIso, inv.endIso, {
      label: inv.title,
      className: style.className,
      borderClassName: style.borderClassName,
      meeting: {
        notificationId: inv.notificationId,
        rsvp: inv.rsvp,
        notePageId: inv.notePageId,
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
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col">
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
      {enableDragCreate && (
        <p className="px-1 pb-2 text-[11px] text-muted-foreground">
          Drag a range on the grid to block off time. To invite people, use the Schedule Meeting tab.
        </p>
      )}
      <WeekGrid
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

// Hard-coded dark text that doesn't flip in dark mode (the dark-blue token does).
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
const EVENT_CORAL = `bg-accent-coral-light ${EVENT_TEXT}`;

// Schedule-preview availability tint: interpolate from white (no one free) to a
// deep sage (everyone free) by `frac` (0..1). Lerping the color itself — not
// just opacity over a fixed light green — gives real contrast between the
// "few free" and "all free" ends. Deep end is a darkened accent-green
// (#A2D483) so it matches the brand palette while still reading clearly.
const AVAIL_DEEP_GREEN: [number, number, number] = [92, 145, 72]; // #5C9148
function availabilityTint(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const r = Math.round(255 + (AVAIL_DEEP_GREEN[0] - 255) * f);
  const g = Math.round(255 + (AVAIL_DEEP_GREEN[1] - 255) * f);
  const b = Math.round(255 + (AVAIL_DEEP_GREEN[2] - 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ------------------------------------------------------------------ */
/* Schedule view                                                        */
/* ------------------------------------------------------------------ */

type Repeats = "none" | "daily" | "weekly" | "monthly";

const REPEATS_OPTIONS: { value: Repeats; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function repeatsToRRule(r: Repeats): string | null {
  switch (r) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    case "none":
    default:
      return null;
  }
}

// datetime-local strings: "YYYY-MM-DDTHH:mm" in the user's local timezone.
function durationMinutesBetween(startLocal: string, endLocal: string): number {
  if (!startLocal || !endLocal) return 30;
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return 30;
  return Math.round((e - s) / 60_000);
}

// Format a Date as the "YYYY-MM-DDTHH:mm" string a datetime-local input expects,
// in the browser's local timezone (no UTC offset suffix).
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Map a grid day column (UTC-midnight anchored, as the WeekGrid stores its days)
// + a fractional hour into the "YYYY-MM-DDTHH:mm" datetime-local string. Shared
// by the schedule grid and the availability drag-to-create handler.
function dayHourToLocal(dayDateUtc: Date, hour: number): string {
  const y = dayDateUtc.getUTCFullYear();
  const m = dayDateUtc.getUTCMonth();
  const d = dayDateUtc.getUTCDate();
  const h = Math.floor(hour);
  const mins = Math.round((hour - h) * 60);
  return toDatetimeLocal(new Date(y, m, d, h, mins));
}

// Small fixed palette for coloring Timesheet blocks by role — accent-coral is
// reserved for "other calendars" context blocks, so it's excluded here.
const ROLE_COLOR_PALETTE: { className: string; borderClassName: string; dot: string }[] = [
  { className: "bg-accent-teal text-white", borderClassName: "border-accent-teal", dot: "var(--color-accent-teal)" },
  { className: "bg-accent-green text-white", borderClassName: "border-accent-green", dot: "var(--color-accent-green)" },
  { className: "bg-accent-pink text-white", borderClassName: "border-accent-pink", dot: "var(--color-accent-pink)" },
  { className: "bg-accent-yellow text-foreground", borderClassName: "border-accent-yellow", dot: "var(--color-accent-yellow)" },
];

// Deterministic hash of a role bucket key into the palette — stable across
// reloads/re-renders without needing to persist a color assignment anywhere.
function roleColor(key: string): (typeof ROLE_COLOR_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ROLE_COLOR_PALETTE[Math.abs(hash) % ROLE_COLOR_PALETTE.length]!;
}

const UNASSIGNED_ROLE_KEY = "unassigned";

// Shown wherever time can be logged but the user holds no paid role. Every
// entry must attribute to one, so there's nothing valid to submit.
const NO_ROLES_MESSAGE =
  "You have no paid roles this term, so there's nothing to log hours against.";

function timeEntryRoleKey(t: TimeEntryDTO): string {
  return t.assignmentType && t.roleRefId ? `${t.assignmentType}:${t.roleRefId}` : UNASSIGNED_ROLE_KEY;
}

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
          <button
            key={b.key}
            type="button"
            onClick={() => onToggle(b.key)}
            aria-pressed={active}
            title={`${b.label} — ${b.hours.toFixed(2)} hrs this week${active ? "" : " (hidden)"}`}
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
  const parsed = parseRoleOptionKey(value);
  return (
    <label htmlFor={id} className="text-xs text-muted-foreground flex flex-col gap-1">
      Role
      <select
        id={id}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`px-2 py-1.5 text-sm border rounded-md bg-background text-foreground ${
          value ? "border-border" : "border-red-500"
        }`}
      >
        {/* Placeholder, not a choice: every logged hour bills to a real role,
            so this is disabled and can't be submitted (unlike the old
            "Unassigned" option, which silently created unattributable time). */}
        <option value="" disabled>
          Select a role…
        </option>
        {myRoles.map((r) => (
          <option key={roleOptionKey(r)} value={roleOptionKey(r)}>
            {r.label}
          </option>
        ))}
      </select>
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
  const [repeats, setRepeats] = useState<Repeats>("none");
  const [isWork, setIsWork] = useState(false);
  const [roleKey, setRoleKey] = useState(myRoles.length > 0 ? roleOptionKey(myRoles[0]!) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid =
    !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const isRecurring = repeats !== "none";
  const canSubmit =
    title.trim().length > 0 &&
    startEndValid &&
    !submitting &&
    (!isWork || (!isRecurring && roleKey !== ""));

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
      // Drag-to-create only makes personal blocks. Meetings live in the
      // Schedule Meeting tab where the gradient/picker have room to breathe —
      // a popover over the grid couldn't show both.
      const body = new FormData();
      body.set("intent", "add-manual-block");
      body.set("title", title.trim());
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      const rrule = repeatsToRRule(repeats);
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

  return (
    <div
      className="w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
      role="dialog"
      aria-modal="false"
      aria-label="New personal block"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">New personal block</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Blocks your own time. Not shared with anyone. To invite people, use
            the <strong>Schedule Meeting</strong> tab.
          </p>

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
              <input
                id="drag-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground"
              />
            </div>
            <div>
              <label htmlFor="drag-end" className="block text-sm font-medium text-foreground mb-1">
                Ends
              </label>
              <input
                id="drag-end"
                type="datetime-local"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className={`w-full px-2 py-2 text-sm border rounded-md bg-background text-foreground ${
                  startEndValid ? "border-border" : "border-red-500"
                }`}
              />
            </div>
          </div>
          {!startEndValid && <p className="text-xs text-red-600">End must be after start.</p>}

          <div>
            <label htmlFor="drag-repeats" className="block text-sm font-medium text-foreground mb-1">
              Repeats
            </label>
            <select
              id="drag-repeats"
              value={repeats}
              onChange={(e) => setRepeats(e.target.value as Repeats)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            >
              {REPEATS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {myRoles.length > 0 && !isRecurring && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={isWork}
                  onChange={(e) => setIsWork(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                This is work
              </label>
              {isWork && (
                <select
                  aria-label="Which role is this work for"
                  value={roleKey}
                  onChange={(e) => setRoleKey(e.target.value)}
                  className="mt-2 w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
                >
                  {myRoles.map((r) => (
                    <option key={roleOptionKey(r)} value={roleOptionKey(r)}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {isRecurring && (
            <p className="text-xs text-muted-foreground">
              Recurring blocks can't be logged as work yet — add each occurrence individually on
              the Timesheet tab if you need hours for it.
            </p>
          )}

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
              {submitting ? "Creating…" : "Add block"}
            </button>
          </div>
        </form>
    </div>
  );
}

function ScheduleView({ data }: { data: LoaderData }) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
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

// Given a calendar day (any value whose UTC Y/M/D is the intended day — a
// plain "YYYY-MM-DD" input value, or a TimeEntry.date, both of which encode
// the picked day as UTC midnight) and a duration, returns a nominal
// [startHour, startHour+hours) range on that day in `timezone`. Used so a
// quick-add entry (no time-of-day picked) still places as a real block on
// the Timesheet week grid.
function nominalDayRange(
  dateLike: string,
  hours: number,
  timezone: string,
  startHour = 9,
): { startIso: string; endIso: string } {
  const d = new Date(dateLike);
  const dayStart = zonedDayStartUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timezone);
  const start = new Date(dayStart.getTime() + startHour * 3_600_000);
  const end = new Date(start.getTime() + Math.max(hours, 0.25) * 3_600_000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// Combine a "YYYY-MM-DD" day and a "HH:MM" wall-clock time into the real UTC
// instant for that moment in `timezone`, so a typed entry lands on the grid
// exactly where a dragged one would.
function localDayTimeToIso(date: string, time: string, timezone: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) return null;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dayStart = zonedDayStartUtc(y, m, d, timezone);
  return new Date(dayStart.getTime() + (hh * 60 + mm) * 60_000).toISOString();
}

function todayDateInputValue(timezone: string): string {
  const { year, month, day } = getZonedYMD(new Date(), timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function TimesheetView({ data }: { data: LoaderData }) {
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
      <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-semibold text-foreground">Timesheet</h2>
          {/* Adding an outside job is how someone with no current DALI
              assignment gets a role to log against, so it stays reachable even
              when the form below is showing the no-roles message. */}
          <CustomHiresManager
            hires={data.myRoles
              .filter((r) => r.assignmentType === "Custom")
              .map((r) => ({ id: r.roleRefId, label: r.label }))}
          />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Meeting-sourced entries are added automatically when someone checks you present on a
          meeting note's attendance checklist. Every entry shows up as a block on the calendar
          below — add one here, or drag a range on the calendar. Click a block on the calendar to
          edit or delete it.
        </p>

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
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              Date
              <input
                type="date"
                name="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              Start
              <input
                type="time"
                required
                step="900"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              End
              <input
                type="time"
                required
                step="900"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-invalid={!!rangeError}
                className={`px-2 py-1.5 text-sm border rounded-md bg-background text-foreground ${
                  rangeError ? "border-red-500" : "border-border"
                }`}
              />
            </label>
            <RoleSelectField
              id="add-time-entry-role"
              myRoles={data.myRoles}
              value={roleKey}
              onChange={setRoleKey}
            />
            <label className="text-xs text-muted-foreground flex flex-col gap-1 sm:col-span-2 xl:col-span-1">
              Note
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What did you work on?"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground resize-y min-h-[2.25rem]"
              />
            </label>
            <div className="flex items-center gap-1.5 sm:col-span-2 sm:justify-end xl:col-span-1 xl:justify-start">
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50"
              >
                Add
              </button>
              <Tooltip label="Reset">
                <button
                  type="button"
                  onClick={resetAddForm}
                  aria-label="Reset"
                  className="inline-flex items-center justify-center p-1.5 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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

  const roleBuckets = new Map<string, { key: string; label: string; hours: number }>();
  for (const { t } of weekEntries) {
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
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col">
      <WeekToolbar
        monthLabel={monthLabel}
        weekStartIso={data.weekStartIso}
        onRefresh={refresh}
        refreshing={revalidator.state !== "idle"}
      />
      <p className="px-1 pb-2 text-[11px] text-muted-foreground">
        Drag a range to log time, or click any block to edit role, time, or note. See My
        Availability for your full calendar.
      </p>
      <RoleFilterRow
        buckets={Array.from(roleBuckets.values())}
        excludedKeys={excludedRoleKeys}
        onToggle={toggleRoleKey}
      />
      <WeekGrid
        days={days}
        showSubHourGrid
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
      className="w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
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

      <form onSubmit={submit} className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-drag-start" className="block text-sm font-medium text-foreground mb-1">
              Starts
            </label>
            <input
              id="ts-drag-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </div>
          <div>
            <label htmlFor="ts-drag-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <input
              id="ts-drag-end"
              type="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={`w-full px-2 py-2 text-sm border rounded-md bg-background text-foreground ${
                startEndValid ? "border-border" : "border-red-500"
              }`}
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
            <select
              id="ts-drag-role"
              required
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-md bg-background text-foreground ${
                roleKey ? "border-border" : "border-red-500"
              }`}
            >
              <option value="" disabled>
                Select a role…
              </option>
              {myRoles.map((r) => (
                <option key={roleOptionKey(r)} value={roleOptionKey(r)}>
                  {r.label}
                </option>
              ))}
            </select>
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
      className="w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
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

      <form onSubmit={submit} className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-edit-start" className="block text-sm font-medium text-foreground mb-1">
              Starts
            </label>
            <input
              id="ts-edit-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </div>
          <div>
            <label htmlFor="ts-edit-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <input
              id="ts-edit-end"
              type="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={`w-full px-2 py-2 text-sm border rounded-md bg-background text-foreground ${
                startEndValid ? "border-border" : "border-red-500"
              }`}
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
          <select
            id="ts-edit-role"
            required
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            className={`w-full px-3 py-2 text-sm border rounded-md bg-background text-foreground ${
              roleKey ? "border-border" : "border-red-500"
            }`}
          >
            {/* Disabled placeholder rather than an "Unassigned" choice. A
                legacy unattributed entry still opens here with nothing
                selected — saving then forces a real role, which is the point. */}
            <option value="" disabled>
              Select a role…
            </option>
            {roleKey &&
              !myRoles.some((r) => roleOptionKey(r) === roleKey) && (
                <option value={roleKey}>Current role (no longer active)</option>
              )}
            {myRoles.map((r) => (
              <option key={roleOptionKey(r)} value={roleOptionKey(r)}>
                {r.label}
              </option>
            ))}
          </select>
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
  const [title, setTitle] = useState("");
  const [repeats, setRepeats] = useState<Repeats>("none");
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
      const rrule = repeatsToRRule(repeats);
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
        setRepeats("none");
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
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
      <h2 className="font-heading font-semibold text-foreground mb-4">Create Meeting</h2>
      <form onSubmit={submit} className="space-y-5">
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
              <input
                id="meeting-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => {
                  const next = e.target.value;
                  onStartLocalChange(next);
                  if (next && (!endLocal || new Date(endLocal).getTime() <= new Date(next).getTime())) {
                    const d = new Date(next);
                    d.setMinutes(d.getMinutes() + (duration > 0 ? duration : 30));
                    onEndLocalChange(toDatetimeLocal(d));
                  }
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="meeting-end" className={labelClass}>
                Ends
              </label>
              <input
                id="meeting-end"
                type="datetime-local"
                value={endLocal}
                min={startLocal || undefined}
                onChange={(e) => onEndLocalChange(e.target.value)}
                className={`${fieldClass} ${startEndValid ? "" : "border-red-500"}`}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border">
          <div className="pt-3">
            <label htmlFor="meeting-recurrence" className={labelClass}>
              Repeats
            </label>
            <select
              id="meeting-recurrence"
              value={repeats}
              onChange={(e) => setRepeats(e.target.value as Repeats)}
              className={fieldClass}
            >
              {REPEATS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pt-3">
            <label htmlFor="organizer-calendar" className={labelClass}>
              Send invite from
            </label>
            {googleLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground pt-2">
                No Google calendar linked. Link one in My Availability to send Gmail invites.
              </p>
            ) : (
              <select
                id="organizer-calendar"
                value={organizerCalendarLinkId}
                onChange={(e) => setOrganizerCalendarLinkId(e.target.value)}
                className={fieldClass}
              >
                <option value="">No invite (in-app notification only)</option>
                {googleLinks.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName ? `${l.displayName} — ${l.externalEmail}` : l.externalEmail}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Optional add-ons */}
        <div className="space-y-3 pt-1 border-t border-border">
          <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Optional
          </p>

          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={createNote}
                onChange={(e) => setCreateNote(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-border"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Create meeting note
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Adds a note with an attendance checklist
                  {projectId ? " under the project's documents" : " in Lab documents"}. Invites
                  still go only to people and groups in Participants.
                </span>
              </span>
            </label>

            {createNote && (
              <div className="pl-6 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="meeting-type" className={labelClass}>
                      Meeting type
                    </label>
                    <select
                      id="meeting-type"
                      value={meetingType}
                      onChange={(e) => setMeetingType(e.target.value as typeof meetingType)}
                      className={fieldClass}
                    >
                      <option value="Team">Team meeting</option>
                      <option value="Partner">Partner meeting</option>
                      <option value="Other">Other</option>
                    </select>
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
                    <select
                      id="meeting-project"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className={fieldClass}
                    >
                      <option value="">No project — Lab documents</option>
                      {myProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {canSetSelfCheckIn && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selfCheckIn}
                  onChange={(e) => setSelfCheckIn(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Self check-in (QR)
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Attendees mark themselves present. Works with or without a meeting note —
                    {createNote
                      ? " the QR appears on the note."
                      : " you'll get a shareable check-in link after creating."}
                  </span>
                </span>
              </label>
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
                    <a
                      href={`/documents/${status.notePageId}`}
                      target="_blank"
                      rel="noreferrer"
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
                      target="_blank"
                      rel="noreferrer"
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
        <label className="block text-sm font-medium text-foreground">Participants</label>
        <span className="text-xs text-muted-foreground">
          {resolvedCount} unique user{resolvedCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {selectedGroupIds.map((gid) => {
          const g = groupsById.get(gid);
          if (!g) return null;
          return (
            <span
              key={`g:${gid}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
              title={`${g.memberIds.length} member${g.memberIds.length === 1 ? "" : "s"}`}
            >
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
        <div className="mt-2 border border-border rounded-md bg-background p-2 space-y-2">
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

type GroupAvailDay = {
  dayKey: string;
  dayOfWeek: number;
  dayOfMonth: number;
  matches: { startHour: number; durationHours: number }[];
  busy: { startHour: number; durationHours: number }[];
};

type PerUserFree = { userId: string; free: { startIso: string; endIso: string }[] };

type GroupAvailResponse = { days: GroupAvailDay[]; perUser: PerUserFree[] };

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
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col">
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

/* ------------------------------------------------------------------ */
/* Week grid primitives                                                */
/* ------------------------------------------------------------------ */

type EventBlock = {
  startHour: number;
  duration: number;
  label: string;
  /** Tailwind classes for the colored body (bg + text). */
  className: string;
  /** Arbitrary hex background (e.g. a Google calendar colour). Overrides the
   *  className background when set; text flips to a readable on-colour shade. */
  bgColor?: string;
  /** Border color class for the outer wrapper (defaults to matching the body). */
  borderClassName?: string;
  /** Background tint for the buffer strip + frame (e.g. "bg-accent-coral/25"). */
  bufferClassName?: string;
  /** Hours of buffer above the event body. */
  bufferBefore?: number;
  /** Hours of buffer below the event body. */
  bufferAfter?: number;
  location?: string;
  description?: string;
  /** When set, the block is clickable (e.g. Timesheet entries opening an edit
   *  popover). Stops the mousedown from bubbling to the column's drag-select
   *  handler so a click doesn't also start a new drag selection. */
  onClick?: () => void;
  /** When set, the block is a meeting invite: clicking opens a persistent
   *  popover with Accept/Maybe/Decline (RSVP lives on the invite Notification,
   *  so notificationId targets the RSVP endpoint). */
  meeting?: {
    notificationId: string;
    rsvp: "Accepted" | "Declined" | "Tentative" | null;
    notePageId: string | null;
  };
};

// RSVP status → block styling on the calendar. Pending (unanswered) invites get
// a dashed teal outline to read as "needs response"; answered ones adopt a
// solid tint keyed to the response (declined is muted/greyed).
function meetingBlockStyle(rsvp: MeetingInviteDTO["rsvp"]): {
  className: string;
  borderClassName: string;
} {
  switch (rsvp) {
    case "Accepted":
      return { className: `bg-accent-teal-light ${EVENT_TEXT}`, borderClassName: "border-accent-teal" };
    case "Tentative":
      return { className: `bg-accent-yellow ${EVENT_TEXT}`, borderClassName: "border-accent-yellow" };
    case "Declined":
      return { className: "bg-muted text-muted-foreground line-through", borderClassName: "border-border" };
    default:
      return { className: `bg-accent-teal-light ${EVENT_TEXT}`, borderClassName: "border-dashed border-accent-teal" };
  }
}

const RSVP_BADGE: Record<"Accepted" | "Declined" | "Tentative", string> = {
  Accepted: "bg-green-100 text-green-800",
  Declined: "bg-red-100 text-red-800",
  Tentative: "bg-yellow-100 text-yellow-800",
};

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function CalendarEventDetailPopover({
  anchorEl,
  title,
  timeRange,
  location,
  description,
  onClose,
  footer,
}: {
  anchorEl: HTMLElement | null;
  title: string;
  timeRange: string;
  location?: string;
  description?: string;
  // When set, the popover is interactive (click-opened): a backdrop dismisses
  // it and Escape closes it. Hover popovers leave this undefined.
  onClose?: () => void;
  footer?: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
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
  }, [anchorEl, title, timeRange, location, description]);

  if (typeof document === "undefined") return null;

  const measured = pos != null;
  let left = pos?.left ?? 0;
  let top = pos?.top ?? 0;
  if (!measured) {
    const a = anchorEl?.getBoundingClientRect();
    if (a) {
      const CARD_W = 288;
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
    <>
      {onClose && (
        <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      )}
      <div
        ref={cardRef}
        className="fixed z-50 w-72 max-h-80 overflow-y-auto rounded-md shadow-lg p-2.5 text-xs"
        style={{
          left,
          top,
          visibility: measured ? "visible" : "hidden",
          backgroundColor: "var(--color-card)",
          color: "var(--color-foreground)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-muted-foreground mt-0.5">{timeRange}</div>
        {location && (
          <div className="mt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
              Location
            </div>
            <div className="text-foreground whitespace-pre-wrap break-words">{location}</div>
          </div>
        )}
        {description && (
          <div className="mt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
              Description
            </div>
            <div className="text-foreground whitespace-pre-wrap break-words">{description}</div>
          </div>
        )}
        {footer}
      </div>
    </>,
    document.body,
  );
}

// Pick dark or light ink for a solid fill by its perceived luminance, so
// custom event colors (which arrive as arbitrary hex — light Google "Banana"
// through dark "Blueberry") stay readable instead of always getting white text.
// Falls back to white for anything we can't parse as a hex color.
function readableTextColor(bg: string): string {
  const hex = bg.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/(.)/g, "$1$1") : hex;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Rec. 601 luma; above ~0.6 the fill reads as light → switch to dark ink.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#1e2733" : "#ffffff";
}

function WeekGridEvent({ e }: { e: EventBlock }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const bufferBefore = e.bufferBefore ?? 0;
  const bufferAfter = e.bufferAfter ?? 0;
  const totalHours = bufferBefore + e.duration + bufferAfter;
  const border = e.borderClassName ? `border-2 ${e.borderClassName}` : "";
  const bufferBg = e.bufferClassName ?? "";
  const bodyHeight = e.duration * HOUR_PX;
  const timeRange = `${formatHourMinute(e.startHour)} – ${formatHourMinute(e.startHour + e.duration)}`;
  const isMeeting = Boolean(e.meeting);
  // Meeting invites open a persistent (click) popover with RSVP controls;
  // other detail-bearing blocks keep the hover popover.
  const hasDetails = Boolean(e.location || e.description);
  const clickable = Boolean(e.onClick || isMeeting);

  return (
    <div
      className={`absolute left-0 right-0 ${bufferBefore === 0 ? "rounded-t-md" : ""} ${
        bufferAfter === 0 ? "rounded-b-md" : ""
      } ${border} ${bufferBg} overflow-hidden ${clickable ? "cursor-pointer" : ""}`}
      style={{
        top: (e.startHour - bufferBefore - HOURS[0]) * HOUR_PX,
        height: totalHours * HOUR_PX,
      }}
      // Always swallow mousedown, even with no onClick. The day column starts
      // a drag-to-create on any mousedown that reaches it, and its mouseup
      // commits a selection even with zero movement — so without this, clicking
      // an existing block opens a bogus "New entry" popover on top of it.
      // Previously this was gated on `e.onClick`, which is why only the
      // clickable (Manual) blocks were protected.
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={isMeeting ? () => setDetailOpen((v) => !v) : e.onClick}
    >
      <div
        ref={setAnchorEl}
        className={`absolute left-0 right-0 ${bufferBefore === 0 ? "rounded-t-md" : ""} ${
          bufferAfter === 0 ? "rounded-b-md" : ""
        } px-1.5 py-1 text-xs font-semibold leading-tight overflow-hidden transition-shadow shadow-[inset_3px_0_0_0_rgba(0,0,0,0.18),0_1px_2px_-1px_rgba(0,0,0,0.15)] ${e.className} ${
          clickable
            ? "hover:ring-2 hover:ring-inset hover:ring-white/60 hover:shadow-[inset_3px_0_0_0_rgba(0,0,0,0.18),0_2px_5px_-1px_rgba(0,0,0,0.25)]"
            : ""
        }`}
        style={{
          top: bufferBefore * HOUR_PX,
          height: bodyHeight,
          ...(e.bgColor
            ? { backgroundColor: e.bgColor, color: readableTextColor(e.bgColor) }
            : {}),
        }}
        onMouseEnter={hasDetails && !isMeeting ? () => setDetailOpen(true) : undefined}
        onMouseLeave={hasDetails && !isMeeting ? () => setDetailOpen(false) : undefined}
      >
        {e.label && <span className="truncate block">{e.label}</span>}
        {bodyHeight >= 34 && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-75">
            {timeRange}
          </span>
        )}
        {isMeeting && e.meeting?.rsvp && bodyHeight >= 50 && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-90">
            {e.meeting.rsvp}
          </span>
        )}
        {bodyHeight >= 50 && e.location && !isMeeting && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-90">
            {e.location}
          </span>
        )}
      </div>
      {detailOpen && isMeeting && e.meeting && (
        <CalendarEventDetailPopover
          anchorEl={anchorEl}
          title={e.label}
          timeRange={timeRange}
          onClose={() => setDetailOpen(false)}
          footer={
            <div className="mt-2 border-t border-border pt-2" onMouseDown={(ev) => ev.stopPropagation()}>
              <div className="flex items-center gap-2">
                <span className="uppercase tracking-wide text-[10px] text-muted-foreground">
                  Your RSVP
                </span>
                {e.meeting.rsvp ? (
                  <span
                    className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${RSVP_BADGE[e.meeting.rsvp]}`}
                  >
                    {e.meeting.rsvp}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">No response yet</span>
                )}
              </div>
              <RsvpButtons
                notificationId={e.meeting.notificationId}
                onResponded={() => setDetailOpen(false)}
              />
              {e.meeting.notePageId && (
                <Link
                  to={`/documents/${e.meeting.notePageId}`}
                  className="mt-2 inline-block text-[11px] font-medium text-accent-coral hover:underline"
                >
                  Open meeting note →
                </Link>
              )}
            </div>
          }
        />
      )}
      {detailOpen && hasDetails && !isMeeting && (
        <CalendarEventDetailPopover
          anchorEl={anchorEl}
          title={e.label}
          timeRange={timeRange}
          location={e.location}
          description={e.description}
        />
      )}
    </div>
  );
}

function WeekGrid({
  days,
  eventsByDay,
  backgroundLayer,
  overlayLayer,
  showProviderRow = false,
  onDayPointerSelect,
  selection,
  selectionPopover,
  onSelectionDismiss,
  onSelectionResize,
  showSubHourGrid = false,
  timezone,
}: {
  days: { dayOfWeek: number; num: number; dateUtc: Date }[];
  eventsByDay: Record<number, EventBlock[]>;
  backgroundLayer?: (dayIdx: number) => React.ReactNode;
  overlayLayer?: (dayIdx: number) => React.ReactNode;
  showProviderRow?: boolean;
  onDayPointerSelect?: (dayIdx: number, startHour: number, endHour: number) => void;
  // A committed selection (controlled by the parent) drawn as a persistent
  // accent block. selectionPopover renders the editor in a viewport-clamped
  // portal; onSelectionDismiss fires when the user clicks the grid backdrop.
  // onSelectionResize fires while dragging the block's top/bottom handles.
  selection?: { dayIdx: number; startHour: number; endHour: number } | null;
  selectionPopover?: () => React.ReactNode;
  onSelectionDismiss?: () => void;
  onSelectionResize?: (startHour: number, endHour: number) => void;
  showSubHourGrid?: boolean;
  // When set, the column matching "today" in this timezone is highlighted and a
  // horizontal current-time line is drawn in it.
  timezone?: string;
}) {
  // Current time, in this timezone, for the today-highlight + now-line. Both are
  // skipped until `now` is set (post-mount) and when no timezone is provided.
  const now = useNow();
  const todayIdx =
    timezone && now
      ? (() => {
          const ymd = getZonedYMD(now, timezone);
          return days.findIndex(
            (d) =>
              d.dateUtc.getUTCFullYear() === ymd.year &&
              d.dateUtc.getUTCMonth() + 1 === ymd.month &&
              d.dateUtc.getUTCDate() === ymd.day,
          );
        })()
      : -1;
  // Pixel offset of the now-line within a column body, or null when "now" falls
  // outside the visible hour window (line is hidden rather than pinned to an edge).
  const nowLineTop = (() => {
    if (!timezone || !now) return null;
    const frac = getZonedHourFraction(now, timezone);
    if (frac < HOURS[0] || frac >= HOURS[HOURS.length - 1] + 1) return null;
    return (frac - HOURS[0]) * HOUR_PX;
  })();
  // Drag-to-select state. We snap to 15-minute steps and clamp to the visible
  // hour range. dragAnchor is where mousedown happened; dragHover is where the
  // pointer currently is — both are stored as fractional hours.
  const [drag, setDrag] = useState<
    null | { dayIdx: number; anchor: number; hover: number }
  >(null);

  // Resize-drag state for the committed selection's top/bottom handles. `edge`
  // says which end is moving; `fixed` is the opposite end's hour (held still).
  const [resize, setResize] = useState<
    null | { edge: "start" | "end"; fixed: number }
  >(null);
  // Dragging the committed selection's body to move it whole (duration fixed).
  // `grabOffset` is how far into the block the pointer grabbed, so the block
  // tracks the cursor instead of snapping its top edge under it.
  const [move, setMove] = useState<null | { grabOffset: number; duration: number }>(null);

  // Column DOM refs so window-level mousemove can compute Y relative to the
  // column the drag started in, even when the cursor strays elsewhere.
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The committed selection block element, so the portal popover can anchor to
  // its real on-screen rect. A callback ref into state (not a plain useRef)
  // guarantees the portal re-renders the moment the node attaches — a shared
  // useRef read from a sibling left anchor stuck null.
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);

  const MIN_HOUR = HOURS[0];
  const MAX_HOUR = HOURS[HOURS.length - 1] + 1;

  const hourFromY = (offsetY: number): number => {
    const raw = MIN_HOUR + offsetY / HOUR_PX;
    const snapped = Math.round(raw / SNAP_HOURS) * SNAP_HOURS;
    return Math.max(MIN_HOUR, Math.min(MAX_HOUR, snapped));
  };

  const onDayMouseDown = (dayIdx: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDayPointerSelect) return;
    if (e.button !== 0) return;
    // While a selection's editor is open, freeze the grid: a new drag would
    // move the committed selection out from under the open form. (The popover
    // itself lives in a body portal, so its clicks never reach a column — this
    // only guards clicks on the grid behind/around it.)
    if (selection) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const h = hourFromY(e.clientY - rect.top);
    setDrag({ dayIdx, anchor: h, hover: h });
    e.preventDefault();
  };

  // Window-level mousemove + mouseup so the drag keeps tracking even when the
  // cursor leaves the original column.
  useEffect(() => {
    if (!drag || !onDayPointerSelect) return;
    const col = columnRefs.current[drag.dayIdx];
    const onMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      setDrag((prev) =>
        prev ? { ...prev, hover: hourFromY(e.clientY - rect.top) } : prev,
      );
    };
    const onUp = () => {
      const lo = Math.min(drag.anchor, drag.hover);
      const hi = Math.max(drag.anchor, drag.hover);
      const start = lo;
      const end = hi - lo < SNAP_HOURS ? Math.min(MAX_HOUR, lo + SNAP_HOURS * 2) : hi;
      onDayPointerSelect(drag.dayIdx, start, end);
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onDayPointerSelect, MAX_HOUR]);

  // Resizing the committed selection by dragging its top/bottom handle. The
  // moving edge follows the cursor (snapped, clamped, never crossing the fixed
  // edge); onSelectionResize streams the new range up so the popover form and
  // the block stay in sync live.
  const startResize = (edge: "start" | "end") => (e: React.MouseEvent) => {
    if (!selection || !onSelectionResize) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setResize({ edge, fixed: edge === "start" ? selection.endHour : selection.startHour });
  };

  useEffect(() => {
    if (!resize || !selection || !onSelectionResize) return;
    const col = columnRefs.current[selection.dayIdx];
    const onMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const h = hourFromY(e.clientY - rect.top);
      // Keep at least one snap-step of height and don't let edges cross.
      if (resize.edge === "start") {
        const start = Math.min(h, resize.fixed - SNAP_HOURS);
        onSelectionResize(Math.max(MIN_HOUR, start), resize.fixed);
      } else {
        const end = Math.max(h, resize.fixed + SNAP_HOURS);
        onSelectionResize(resize.fixed, Math.min(MAX_HOUR, end));
      }
    };
    const onUp = () => setResize(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resize, selection, onSelectionResize, MIN_HOUR, MAX_HOUR]);

  // Moving the committed selection up/down as a whole. Duration is preserved:
  // the range slides, and is clamped so neither edge leaves the visible day
  // rather than being squashed at the boundary.
  const startMove = (e: React.MouseEvent) => {
    if (!selection || !onSelectionResize) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const col = columnRefs.current[selection.dayIdx];
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const pointerHour = hourFromY(e.clientY - rect.top);
    setMove({
      grabOffset: pointerHour - selection.startHour,
      duration: selection.endHour - selection.startHour,
    });
  };

  useEffect(() => {
    if (!move || !selection || !onSelectionResize) return;
    const col = columnRefs.current[selection.dayIdx];
    const onMouseMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const pointerHour = hourFromY(e.clientY - rect.top);
      const start = Math.min(
        Math.max(MIN_HOUR, pointerHour - move.grabOffset),
        MAX_HOUR - move.duration,
      );
      onSelectionResize(start, start + move.duration);
    };
    const onUp = () => setMove(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [move, selection, onSelectionResize, MIN_HOUR, MAX_HOUR]);

  return (
    <div className="relative">
    <div className="flex border border-border rounded-md overflow-hidden select-none">
      {/* Hour axis */}
      <div className="flex flex-col w-14 border-r border-border bg-card text-[11px] text-muted-foreground">
        <div className={showProviderRow ? "h-16 border-b border-border" : "h-9 border-b border-border"} />
        {HOURS.map((h) => (
          <div key={h} style={{ height: HOUR_PX }} className="px-2 pt-1 text-right">
            {formatHour(h)}
          </div>
        ))}
      </div>
      {/* Day columns */}
      {days.map((d, idx) => {
        const isToday = idx === todayIdx;
        return (
        <div key={idx} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
          <div className={`flex flex-col items-center justify-center border-b border-border ${showProviderRow ? "h-16" : "h-9"} ${isToday ? "bg-accent-coral/10" : ""}`}>
            <div className={`text-[10px] font-semibold tracking-wide ${isToday ? "text-accent-coral" : "text-muted-foreground"}`}>{DAY_KEYS[d.dayOfWeek]}</div>
            <div className={isToday ? "flex items-center justify-center w-6 h-6 rounded-full bg-accent-coral text-sm font-bold text-white" : "text-sm font-bold text-foreground"}>{d.num}</div>
            {showProviderRow && (
              <div className="flex items-center gap-0.5 mt-0.5 text-muted-foreground/50">
                <Building2 className="w-2.5 h-2.5" />
                <Wifi className="w-2.5 h-2.5" />
              </div>
            )}
          </div>
          <div
            ref={(el) => {
              columnRefs.current[idx] = el;
            }}
            className={`relative ${onDayPointerSelect ? "cursor-crosshair" : ""}`}
            style={{ height: HOURS.length * HOUR_PX }}
            onMouseDown={onDayPointerSelect ? onDayMouseDown(idx) : undefined}
          >
            {HOURS.map((_, i) => (
              <Fragment key={i}>
                {/* Hour line — distinctly heavier (2px, darker) than the faint
                    10-minute sub-hour lines. */}
                <div
                  className="absolute left-0 right-0 border-t-2 border-foreground/45"
                  style={{ top: i * HOUR_PX }}
                />
                {showSubHourGrid &&
                  // 10-minute sub-hour lines (skip index 0; that's the hour line).
                  Array.from({ length: SUBDIVISIONS_PER_HOUR - 1 }).map((_, s) => (
                    <div
                      key={s}
                      className="absolute left-0 right-0 border-t border-foreground/[0.08]"
                      style={{ top: i * HOUR_PX + (HOUR_PX * (s + 1)) / SUBDIVISIONS_PER_HOUR }}
                    />
                  ))}
              </Fragment>
            ))}
            {backgroundLayer?.(idx)}
            {/* Redraw the grid lines above the availability tint so they stay
                visible over the colored background — but BEFORE events, so
                Busy blocks render on top of the lines (not the other way
                round). Hour lines bolder than the 10-minute sub-hour lines. */}
            {showSubHourGrid &&
              HOURS.map((_, i) => (
                <Fragment key={`grid-fg-${i}`}>
                  <div
                    className="absolute left-0 right-0 border-t-2 border-foreground/40 pointer-events-none"
                    style={{ top: i * HOUR_PX }}
                  />
                  {Array.from({ length: SUBDIVISIONS_PER_HOUR - 1 }).map((_, s) => (
                    <div
                      key={s}
                      className="absolute left-0 right-0 border-t border-foreground/[0.08] pointer-events-none"
                      style={{ top: i * HOUR_PX + (HOUR_PX * (s + 1)) / SUBDIVISIONS_PER_HOUR }}
                    />
                  ))}
                </Fragment>
              ))}
            {isToday && nowLineTop != null && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-accent-coral pointer-events-none z-30"
                style={{ top: nowLineTop }}
                aria-label="Current time"
              >
                <div className="absolute left-0 -top-[3px] w-2 h-2 rounded-full bg-accent-coral" />
              </div>
            )}
            {drag && drag.dayIdx === idx && (() => {
              const lo = Math.min(drag.anchor, drag.hover);
              const hi = Math.max(drag.anchor, drag.hover);
              const heightHours = Math.max(SNAP_HOURS, hi - lo);
              const top = (lo - MIN_HOUR) * HOUR_PX;
              // Caption sits above the rectangle's top edge so a short (e.g.
              // 10-min) selection doesn't have the text spilling through the
              // box into the slot below. Near the grid's top there's no room
              // above (the column clips overflow), so drop it just inside.
              const captionBelow = top < 16;
              return (
                <div
                  className="absolute left-0 right-0 border-2 border-accent-coral bg-accent-coral/15 pointer-events-none rounded-sm z-30 shadow-md"
                  style={{ top, height: heightHours * HOUR_PX }}
                >
                  <div
                    className={`absolute left-0 px-1 py-0.5 rounded bg-white/75 text-[11px] font-semibold leading-none whitespace-nowrap text-accent-coral ${
                      captionBelow ? "top-1" : "bottom-full mb-1"
                    }`}
                  >
                    {formatHourMinute(lo)} – {formatHourMinute(hi)}
                  </div>
                </div>
              );
            })()}
            {/* Committed selection block — stays drawn where the drag landed,
                with top/bottom handles to resize it. The editor popover renders
                in a viewport-clamped portal (below), not clipped by the grid. */}
            {selection && selection.dayIdx === idx && (() => {
              const lo = selection.startHour;
              const hi = selection.endHour;
              const top = (lo - MIN_HOUR) * HOUR_PX;
              const height = Math.max(SNAP_HOURS, hi - lo) * HOUR_PX;
              const resizable = !!onSelectionResize;
              return (
                <div
                  ref={setAnchorEl}
                  // Body drag moves the whole block; the edge handles below
                  // resize it (they stopPropagation so they win over this).
                  onMouseDown={resizable ? startMove : undefined}
                  className={`absolute left-0 right-0 border-2 border-accent-coral bg-accent-coral/15 rounded-sm z-30 ${
                    resizable ? (move ? "cursor-grabbing" : "cursor-grab") : "pointer-events-none"
                  }`}
                  style={{ top, height }}
                >
                  {/* Caption above the top edge — see drag-preview note. */}
                  <div
                    className={`absolute left-0 px-1 py-0.5 rounded bg-white/75 text-[11px] font-semibold leading-none whitespace-nowrap text-accent-coral pointer-events-none ${
                      top < 16 ? "top-1" : "bottom-full mb-1"
                    }`}
                  >
                    {formatHourMinute(lo)} – {formatHourMinute(hi)}
                  </div>
                  {resizable && (
                    <>
                      {/* Top handle */}
                      <div
                        onMouseDown={startResize("start")}
                        className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group"
                        aria-label="Adjust start time"
                      >
                        <span className="w-8 h-1 rounded-full bg-accent-coral group-hover:h-1.5 transition-all" />
                      </div>
                      {/* Bottom handle */}
                      <div
                        onMouseDown={startResize("end")}
                        className="absolute -bottom-1 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group"
                        aria-label="Adjust end time"
                      >
                        <span className="w-8 h-1 rounded-full bg-accent-coral group-hover:h-1.5 transition-all" />
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {(eventsByDay[idx] ?? []).map((e, i) => (
              <WeekGridEvent key={i} e={e} />
            ))}
            {overlayLayer?.(idx)}
          </div>
        </div>
        );
      })}
    </div>
    {/* Editor popover — rendered in a portal at <body>, anchored to the
        selection block's real screen rect and clamped to the viewport, so it
        is never clipped by the grid's overflow or the screen edge. */}
    {selection && selectionPopover && (
      <SelectionPopoverPortal
        anchorEl={anchorEl}
        onDismiss={() => onSelectionDismiss?.()}
      >
        {selectionPopover()}
      </SelectionPopoverPortal>
    )}
    </div>
  );
}

// Floats the selection editor next to the committed block. Renders into <body>
// (so the grid's overflow-hidden can't clip it) and positions itself fixed,
// preferring the block's right side but flipping left / shifting up to stay
// fully on-screen. A transparent full-viewport backdrop captures outside clicks
// to dismiss — and, being in a portal, never lets a click reach a grid column.
function SelectionPopoverPortal({
  anchorEl,
  onDismiss,
  children,
}: {
  anchorEl: HTMLElement | null;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Dismiss on a genuine outside click. We can't use a full-viewport backdrop
  // for this: the selection block (with its resize handles) lives in the grid
  // *under* this portal, so a covering backdrop would swallow handle mousedowns
  // and dismiss the selection the instant the user grabs a handle. Instead,
  // listen at the document and ignore mousedowns that land inside the popover
  // card or the anchored selection block (so resizing it works).
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onDismiss();
    };
    // Capture phase so we see the event even if something stops propagation.
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocMouseDown, true);
  }, [anchorEl, onDismiss]);

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
      // Vertically hug the block: top-align if the card fits below, else
      // bottom-align with the block (open upward) so it stays adjacent instead
      // of being yanked far up by a viewport clamp on a late-day selection.
      let top = a.top + ch + margin <= vh ? a.top : a.bottom - ch;
      top = Math.max(margin, Math.min(top, vh - ch - margin));
      setPos((prev) =>
        prev && prev.left === left && prev.top === top ? prev : { left, top },
      );
    };
    place();
    // Re-place when the card resizes (block→meeting grows it) or the window
    // reflows. Deps include anchorEl so this runs the instant the block mounts.
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

  // First paint (before the layout effect sets pos): derive a spot from the
  // anchor's current rect so the popover appears NEXT TO the block, flipping
  // left / opening upward near the edges. Falls back to centred if no anchor.
  let left = pos?.left;
  let top = pos?.top;
  if (left == null || top == null) {
    const a = anchorEl?.getBoundingClientRect();
    if (a) {
      const CARD_W = 320; // matches w-80
      const CARD_H = 416; // matches max-h-[26rem]
      const gap = 8;
      const margin = 8;
      left = a.right + gap + CARD_W + gap > window.innerWidth
        ? a.left - gap - CARD_W // would overflow right → flip to the left side
        : a.right + gap;
      left = Math.max(margin, left);
      const vh = window.innerHeight;
      const rawTop = a.top + CARD_H + margin <= vh ? a.top : a.bottom - CARD_H;
      top = Math.max(margin, Math.min(rawTop, vh - CARD_H - margin));
    } else {
      left = Math.max(8, window.innerWidth / 2 - 160);
      top = 80;
    }
  }

  return createPortal(
    // No covering backdrop: the card is positioned `fixed` on its own so it
    // doesn't sit over the grid's selection block, leaving the block's resize
    // handles clickable. Outside-click dismissal is handled by the document
    // listener above. The card still stops propagation so a click inside the
    // form can't bubble out to anything behind it.
    <div
      ref={cardRef}
      data-calendar-popover
      className="fixed z-50"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

// Fractional hour → "9:15 AM" / "12:00 PM" style label for drag tooltips.
function formatHourMinute(h: number) {
  const totalMin = Math.round(h * 60);
  const hour24 = Math.floor(totalMin / 60) % 24;
  const minute = totalMin % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,120,120,0.35) 0 6px, transparent 6px 12px)",
  backgroundColor: "rgba(120,120,120,0.25)",
};

function DayBg({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`absolute inset-0 ${className ?? ""}`} style={style} />;
}

// Renders the striped "outside working hours" overlay for a single day column.
// Hours inside any working-hours segment are left blank (or washed). Used by
// both the AvailabilityWeekGrid and the schedule-preview's self-only mode.
function workingHoursStripeLayer(
  workingHours: WhDay[],
  dow: number,
  options?: { enabled?: boolean },
): React.ReactNode {
  // When the Working Hours feature is off, the whole day is unrestricted — draw
  // no "outside hours" stripes at all.
  if (options?.enabled === false) return null;
  const wh = workingHours.find((w) => w.dayOfWeek === dow);
  if (!wh || wh.segments.length === 0) return <DayBg style={STRIPE_STYLE} />;
  const sorted = wh.segments
    .map((s) => ({ start: s.startMinute / 60, end: s.endMinute / 60 }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  const dayStart = HOURS[0];
  const dayEnd = HOURS[HOURS.length - 1] + 1;
  const stripes: { startHour: number; duration: number }[] = [];
  let cursor = dayStart;
  for (const m of merged) {
    if (m.start > cursor) stripes.push({ startHour: cursor, duration: m.start - cursor });
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < dayEnd) stripes.push({ startHour: cursor, duration: dayEnd - cursor });
  return (
    <>
      {stripes.map((s, i) => (
        <BlockBlock
          key={`stripe-${i}`}
          topHour={dayStart}
          startHour={s.startHour}
          duration={s.duration}
          style={STRIPE_STYLE}
        />
      ))}
    </>
  );
}

function BlockBlock({
  topHour,
  startHour,
  duration,
  className,
  style,
}: {
  topHour: number;
  startHour: number;
  duration: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (duration <= 0) return null;
  return (
    <div
      className={`absolute left-0 right-0 ${className ?? ""}`}
      style={{
        top: (startHour - topHour) * HOUR_PX,
        height: duration * HOUR_PX,
        ...style,
      }}
    />
  );
}

