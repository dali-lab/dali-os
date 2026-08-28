import { useSearchParams, useRevalidator } from "react-router";
import { useState, useEffect } from "react";
import { PanelLeftOpen, PanelLeftClose, CalendarDays, CalendarPlus, Clock } from "lucide-react";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import {
  EVENT_CORAL,
  durationMinutesBetween,
  dayHourToLocal,
  meetingBlockStyle,
} from "~/calendar/lib/event-block";
import {
  WeekGrid,
  useRefreshOnFocus,
  workingHoursStripeLayer,
} from "~/calendar/components/WeekGrid";
import {
  CalendarIntegrationsCard,
  WorkingHoursCard,
  EventBuffersCard,
  ManualBlocksCard,
} from "~/calendar/components/settings-cards";
import {
  WeekToolbar,
  ScheduleWeekGrid,
  CreateScheduledMeetingForm,
} from "~/calendar/components/scheduling";
import { TimesheetView, CreateFromDragPopover } from "~/calendar/components/timesheet";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { LoaderData } from "~/calendar/lib/types";
import type { EventBlock } from "~/calendar/lib/types";

type Tab = "availability" | "schedule" | "timesheet";

const CALENDAR_TAB_STORAGE_KEY = "dali:calendar:tab";
const AVAILABILITY_SIDEBAR_COLLAPSED_KEY = "dali:calendar:availability:sidebar-collapsed";

export function LegacyCalendarTabs({ data }: { data: LoaderData }) {
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
