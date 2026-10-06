// loadSchedulingData — the subset of the calendar loader's LoaderData that
// CreateEventModal needs to run in `mode="meeting-only"` outside the calendar
// route (e.g. the partner CRM's interview scheduler, via GET
// /api/scheduling-data). Builds the same pieces loadCalendarData does, reusing
// buildCalendarLinkDTO and loadParticipantOptions so the two loaders can never
// drift; loadCalendarData itself is untouched.

import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { canViewForms, isCore, currentTerm } from "~/lib/roles";
import { resolveUserTimeZone } from "~/lib/timezone";
import { DEFAULT_BUFFER_MIN, defaultWorkingHours } from "~/calendar/lib/calendar-defaults";
import { weekWindow } from "~/calendar/lib/view-window";
import { getValidAccessTokenForLink, listCalendarsForLink } from "~/lib/google-calendar";
import { buildCalendarLinkDTO, loadParticipantOptions } from "~/calendar/routes/calendar.server";
import type { SchedulingData, WhDay, WhSegment } from "~/calendar/lib/types";

export async function loadSchedulingData(
  request: Request,
): Promise<{ ok: true; data: SchedulingData } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return { ok: false, response: portalRedirect };

  const userId = auth.user.sub;
  await currentTerm(request); // warms the per-request term cache roles.ts relies on

  const [settings, userRow, whRows, links, myProjects, canSetSelfCheckIn, canMarkCoreMeeting, participants] =
    await Promise.all([
      prisma.userAvailabilitySettings.findUnique({
        where: { userId },
        select: { defaultEventBufferMin: true, timesheetCalendarId: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
      prisma.workingHoursDay.findMany({
        where: { userId },
        select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true, location: true, enabled: true },
      }),
      prisma.userCalendarLink.findMany({ where: { userId }, orderBy: { linkedAt: "asc" } }),
      prisma.project.findMany({
        where: { assignments: { some: { userId } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Same gate as Forms: Core, Admin, or Instructor.
      canViewForms(userId, request),
      isCore(userId, request),
      loadParticipantOptions(request),
    ]);

  const timezone = resolveUserTimeZone(userRow);
  const bufferMin = settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN;
  const timesheetCalendarId = settings?.timesheetCalendarId ?? null;

  const byDow = new Map<number, WhSegment[]>();
  for (const r of whRows) {
    if (!r.enabled || r.startMinute >= r.endMinute) continue;
    const seg: WhSegment = {
      id: r.id,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      location: r.location,
    };
    const list = byDow.get(r.dayOfWeek);
    if (list) list.push(seg);
    else byDow.set(r.dayOfWeek, [seg]);
  }
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

  // Same per-link Google prefetch loadCalendarData does, just not shared with
  // an external-events read (this loader has none).
  const googleLinks = links.filter((l) => l.provider === "Google");
  const prefetchedCalendarLists = new Map<
    string,
    Awaited<ReturnType<typeof listCalendarsForLink>> | undefined
  >();
  await Promise.all(
    googleLinks.map(async (l) => {
      try {
        const token = await getValidAccessTokenForLink(l.id);
        prefetchedCalendarLists.set(l.id, await listCalendarsForLink(l.id, token));
      } catch {
        prefetchedCalendarLists.set(l.id, undefined);
      }
    }),
  );
  const calendarLinks = await Promise.all(
    links.map((l) => buildCalendarLinkDTO(l, prefetchedCalendarLists, timesheetCalendarId)),
  );

  const data: SchedulingData = {
    timezone,
    defaultEventBufferMin: bufferMin,
    workingHours,
    hasPersistedWorkingHours: hasAnyPersisted,
    calendarLinks,
    currentUserId: userId,
    myProjects,
    // No timesheet logging from this mount — the Timesheet section only shows
    // when myRoles is non-empty, which is correct here (meeting-only callers
    // never log hours against the meeting they're scheduling).
    myRoles: [],
    canSetSelfCheckIn,
    canMarkCoreMeeting,
    groups: participants.groups,
    users: participants.users,
    weekStartIso: weekWindow(timezone).start.toISOString(),
    // No "last used calendar" cookie outside the calendar route — the modal
    // falls back to the first invite destination, which is only read in
    // meeting mode anyway.
    defaultEventDest: null,
  };
  return { ok: true, data };
}
