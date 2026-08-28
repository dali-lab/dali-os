import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Shield,
  CalendarDays,
  CalendarPlus,
  UsersRound,
  X,
  Clock,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Repeat,
  Search,
} from "lucide-react";
import { fullName } from "~/lib/display";
import { type RoleInstance } from "~/lib/roles";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { getZonedYMD, zonedDayStartUtc, zonedWallTimeUtc } from "~/lib/timezone";
import { AnchoredPopover } from "~/calendar/components/AnchoredPopover";
import {
  EventComposer,
  CalendarSearchBar,
  WorkingHoursPopover,
  EventDefaultsPopover,
  CalendarManagerModal,
  ClassesManagerModal,
  eventDestinations,
  LOCAL_DEST,
  type ComposerState,
} from "~/calendar/components/composer";
import { formatPayPeriod, payPeriodFor } from "~/lib/pay-period";
import { loadCalendarData, submitCalendarAction } from "./calendar.server";
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
import { RsvpButtons } from "~/components/RsvpButtons";
import { CustomHiresManager } from "~/calendar/components/CustomHiresManager";
import { DateField } from "~/components/ui/DateField";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";
import type {
  WhDay,
  ManualBlockDTO,
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
  RSVP_BADGE, DAY_KEYS, ATTENDEE_DOT, GUESTS_COLLAPSED,
  durationMinutesBetween, toDatetimeLocal, dayHourToLocal,
  ROLE_COLOR_PALETTE, UNASSIGNED_ROLE_KEY, roleColor, timeEntryRoleKey,
  meetingBlockStyle, readableTextColor,
  nominalDayRange, localDayTimeToIso, todayDateInputValue,
  formatHour, formatHourMinute, shiftWeekParam,
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
  type CalendarLegendGroup,
  computeRoleBuckets,
  timeEntryRange,
  toGridRange,
  DEFAULT_LAYER_VISIBILITY,
  type LayerVisibility,
  type GridDay,
} from "~/calendar/lib/layers";
import { MonthGrid } from "~/calendar/components/MonthGrid";
import { AgendaView } from "~/calendar/components/AgendaView";
import { MiniMonth } from "~/calendar/components/MiniMonth";
import {
  CalendarIntegrationsCard,
  WorkingHoursCard,
  EventBuffersCard,
  ManualBlocksCard,
  GeneralCalendarPrompt,
} from "~/calendar/components/settings-cards";
import { FIELD_BASE, roleOptionKey, parseRoleOptionKey, RoleSelectField, RoleFilterRow } from "~/calendar/components/role-fields";
import { MeetingComposer, ScheduleWeekGrid, CreateScheduledMeetingForm, type AddingMode, ParticipantPicker, ParticipantAvailabilityRoster, SelectedSlotBlock, SlotAttendeePopover, userLabel, WeekToolbar } from "~/calendar/components/scheduling";

// Underline subnav sits flush under the workspace tab bar (see layout embed padding).
// `areaSubnav` (not `areaPills`) because calendar renders its own day/week/month
// UnderlineTabButtons row unconditionally — it isn't the flag-gated AreaPillNav,
// so it reserves the flush top spacing regardless of the sidebar-redesign flag.
export const handle = {
  areaSubnav: true,
  docKey: "calendar",
  docTitle: "Calendar",
};

export async function loader({ request }: Route.LoaderArgs) { return loadCalendarData(request); }

export async function action({ request }: Route.ActionArgs) { return submitCalendarAction(request); }


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
const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day", agenda: "Agenda" };

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
  // Search bar (anchored to its toolbar button). Null anchor = closed.
  const [searchAnchor, setSearchAnchor] = useState<DOMRect | null>(null);
  // Anchored popovers that replaced the old settings modal: working-hours edit
  // (from the layer row), new-event defaults (from the toolbar gear), and the
  // mini-month navigator (from the range label). Null anchor = closed.
  const [hoursAnchor, setHoursAnchor] = useState<DOMRect | null>(null);
  const [defaultsAnchor, setDefaultsAnchor] = useState<DOMRect | null>(null);
  const [miniMonthAnchor, setMiniMonthAnchor] = useState<DOMRect | null>(null);
  const [classesOpen, setClassesOpen] = useState(false);
  const [calMgrOpen, setCalMgrOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // The tentative block drawn on the grid while a create composer is open, so a
  // dragged-out event stays visible (and tracks the composer's time edits)
  // instead of vanishing the moment the popover appears.
  const [createSel, setCreateSel] = useState<{ dayIdx: number; startHour: number; endHour: number } | null>(null);
  // While EDITING an event, overrides that event's time on the grid so the block
  // resizes/moves live as the composer's start/end change — before saving.
  // key is `g:<eventId>` (Google) or `b:<manualBlockId>` (in-app block).
  const [draftEdit, setDraftEdit] = useState<{ key: string; startIso: string; endIso: string } | null>(null);
  const closeComposer = () => {
    setComposer(null);
    setCreateSel(null);
    setDraftEdit(null);
  };
  const eventMoveFetcher = useFetcher();
  // Optimistic move: hold the block at its dropped position until the loader
  // revalidates, so it doesn't flash back to the old frame during the server
  // round-trip. Cleared when the move fetcher settles (data is fresh by then).
  const [dragOverride, setDragOverride] = useState<{ key: string; startIso: string; endIso: string } | null>(null);
  const prevMoveState = useRef(eventMoveFetcher.state);
  useEffect(() => {
    if (prevMoveState.current !== "idle" && eventMoveFetcher.state === "idle") setDragOverride(null);
    prevMoveState.current = eventMoveFetcher.state;
  }, [eventMoveFetcher.state]);
  // The wall-clock Y/M/D a drag lands on: the target day column when the move
  // crossed to another date, else the item's own start day. dayIdx columns are
  // UTC-midnight anchored, so their calendar date reads off the UTC fields.
  const dropYmd = (fallbackIso: string, dayIdx?: number) => {
    const col = dayIdx != null ? days[dayIdx] : undefined;
    if (col)
      return { year: col.dateUtc.getUTCFullYear(), month: col.dateUtc.getUTCMonth() + 1, day: col.dateUtc.getUTCDate() };
    return getZonedYMD(new Date(fallbackIso), data.timezone);
  };
  // Drag-move/resize of a writable event → patch just its time (new day when the
  // move crossed columns, new hours), in the display timezone.
  const moveEvent = (e: ExternalEventDTO, startHour: number, endHour: number, dayIdx?: number) => {
    if (!e.eventId || !e.linkId) return;
    const { year, month, day } = dropYmd(e.startIso, dayIdx);
    const toIso = (h: number) => {
      const mins = Math.round(h * 60);
      return zonedWallTimeUtc(year, month, day, Math.floor(mins / 60), mins % 60, data.timezone).toISOString();
    };
    const startIso = toIso(startHour);
    const endIso = toIso(endHour);
    setDragOverride({ key: `g:${e.eventId}`, startIso, endIso });
    eventMoveFetcher.submit(
      {
        intent: "event-move",
        destination: `${e.linkId}:${e.calendarId ?? "primary"}`,
        eventId: e.eventId,
        startIso,
        endIso,
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
  const moveBlock = (b: ManualBlockDTO, startHour: number, endHour: number, dayIdx?: number) => {
    const { year, month, day } = dropYmd(b.startTime, dayIdx);
    const toIso = (h: number) => {
      const mins = Math.round(h * 60);
      return zonedWallTimeUtc(year, month, day, Math.floor(mins / 60), mins % 60, data.timezone).toISOString();
    };
    const startIso = toIso(startHour);
    const endIso = toIso(endHour);
    setDragOverride({ key: `b:${b.id}`, startIso, endIso });
    eventMoveFetcher.submit(
      {
        intent: "event-move",
        destination: LOCAL_DEST,
        manualBlockId: b.id,
        startIso,
        endIso,
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
  // Agenda shares the month window, so its focus/label track the month too.
  const focusDate =
    view === "month" || view === "agenda" ? new Date(rangeStart.getTime() + 14 * 86_400_000) : rangeStart;
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
  const anyModalOpen =
    Boolean(composer) ||
    classesOpen ||
    calMgrOpen ||
    createOpen ||
    Boolean(searchAnchor) ||
    Boolean(hoursAnchor) ||
    Boolean(defaultsAnchor) ||
    Boolean(miniMonthAnchor);
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
        case "a": changeView("agenda"); break;
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

  // Live time overrides so a block draws at its pending position instead of the
  // stored one: the composer's edit-in-progress (draftEdit) and a just-dropped
  // drag awaiting revalidation (dragOverride). Both keep the block from flashing
  // back to the old frame.
  const overrides = [draftEdit, dragOverride].filter(Boolean) as { key: string; startIso: string; endIso: string }[];
  const layerData: LoaderData = overrides.length
    ? {
        ...data,
        externalEvents: data.externalEvents.map((e) => {
          const o = overrides.find((ov) => ov.key === `g:${e.eventId}`);
          return o ? { ...e, startIso: o.startIso, endIso: o.endIso } : e;
        }),
        manualBlocks: data.manualBlocks.map((b) => {
          const o = overrides.find((ov) => ov.key === `b:${b.id}`);
          return o ? { ...b, startTime: o.startIso, endTime: o.endIso } : b;
        }),
      }
    : data;

  const layerMaps: Record<number, EventBlock[]>[] = [];
  if (layers.external)
    layerMaps.push(
      buildExternalLayer(
        layerData,
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
    const items = buildAllDayItems(layerData, days, hiddenCals);
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
        layerData,
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

  // Keep the grid in step with the composer's time edits. Creating → a tentative
  // block (createSel); editing → override the real event's time (draftEdit) so
  // its block resizes/moves live. All-day or empty draft drops the live preview.
  const syncDraft = (startIso: string, endIso: string, isAllDay: boolean) => {
    if (!composer) return;
    if (composer.mode === "edit") {
      const ev = composer.event;
      const key = ev.eventId ? `g:${ev.eventId}` : ev.manualBlockId ? `b:${ev.manualBlockId}` : null;
      if (!key || isAllDay || !startIso || !endIso) {
        setDraftEdit((p) => (p ? null : p));
        return;
      }
      setDraftEdit((p) =>
        p && p.key === key && p.startIso === startIso && p.endIso === endIso ? p : { key, startIso, endIso },
      );
      return;
    }
    // Create mode → tentative selection block.
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
  else if (view === "month" || view === "agenda") rangeLabel = df(focusDate, { month: "long", year: "numeric" });
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
    // Neither month nor agenda has a time grid to drop into — jump to week first.
    if (view === "month" || view === "agenda") {
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
    const endHour = 9 + data.defaultEventDurationMin / 60;
    setEditor({
      kind: "create",
      dayIdx: idx,
      startHour: 9,
      endHour,
      startLocal: dayHourToLocal(day.dateUtc, 9),
      endLocal: dayHourToLocal(day.dateUtc, endHour),
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
        {mode === "browse" ? (
          <button
            type="button"
            onClick={(e) =>
              setMiniMonthAnchor((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))
            }
            aria-label="Jump to date"
            aria-expanded={Boolean(miniMonthAnchor)}
            className="rounded-md font-heading text-xl font-semibold text-foreground hover:text-accent-coral"
          >
            {rangeLabel}
          </button>
        ) : (
          <h1 className="font-heading text-xl font-semibold text-foreground">{rangeLabel}</h1>
        )}

        <div className="ml-auto flex items-center gap-2">
          {mode === "browse" && (
            <>
              <Tooltip content="Search events">
                <button
                  type="button"
                  onClick={(e) =>
                    setSearchAnchor((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))
                  }
                  aria-label="Search events"
                  aria-expanded={Boolean(searchAnchor)}
                  className={cn(iconToolBtn, "w-8 justify-center px-0")}
                >
                  <Search className="h-4 w-4" />
                </button>
              </Tooltip>

              <div className="inline-flex rounded-lg bg-muted p-0.5">
                {(["month", "week", "day", "agenda"] as CalendarView[]).map((v) => (
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

              <Tooltip content="Event defaults">
                <button
                  type="button"
                  onClick={(e) =>
                    setDefaultsAnchor((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))
                  }
                  aria-label="Event defaults"
                  aria-expanded={Boolean(defaultsAnchor)}
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
                        onEditHours={(rect) => {
                          setCalendarsOpen(false);
                          setHoursAnchor(rect);
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
              {view === "agenda" ? (
                <AgendaView
                  days={days}
                  eventsByDay={eventsByDay}
                  timezone={data.timezone}
                  onSelectDay={goToDay}
                />
              ) : view === "month" ? (
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
                  clickDurationHours={data.defaultEventDurationMin / 60}
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
      {hoursAnchor && (
        <WorkingHoursPopover data={data} anchor={hoursAnchor} onClose={() => setHoursAnchor(null)} />
      )}
      {defaultsAnchor && (
        <EventDefaultsPopover data={data} anchor={defaultsAnchor} onClose={() => setDefaultsAnchor(null)} />
      )}
      {miniMonthAnchor && (
        <AnchoredPopover
          anchor={miniMonthAnchor}
          onClose={() => setMiniMonthAnchor(null)}
          ariaLabel="Jump to date"
          className="rounded-xl border border-border bg-card shadow-brand-3"
        >
          <MiniMonth
            focusDate={focusDate}
            timezone={data.timezone}
            onPick={(dateUtc) => {
              setMiniMonthAnchor(null);
              // Keep the current view; just move the anchor to the picked day.
              setParams((p) => {
                p.set("view", view);
                p.set("anchor", ymdUtc(dateUtc));
                p.delete("weekStart");
              });
            }}
          />
        </AnchoredPopover>
      )}
      {classesOpen && data.classesEnabled && (
        <ClassesManagerModal data={data} onClose={() => setClassesOpen(false)} />
      )}
      {composer && data.crudEnabled && (
        <EventComposer data={data} state={composer} onClose={closeComposer} onDraftChange={syncDraft} />
      )}
      {calMgrOpen && data.crudEnabled && (
        <CalendarManagerModal data={data} onClose={() => setCalMgrOpen(false)} />
      )}
      {searchAnchor && (
        <CalendarSearchBar
          anchor={searchAnchor}
          rangeStartIso={data.rangeStartIso}
          rangeEndIso={data.rangeEndIso}
          timezone={data.timezone}
          onClose={() => setSearchAnchor(null)}
          onSelect={(hit) => {
            // Jump to the event's day in the viewer's timezone — an evening ET
            // event is the next UTC day, so navigate by the zoned Y-M-D, not the
            // raw instant.
            const { year, month, day } = getZonedYMD(new Date(hit.startIso), data.timezone);
            goToDay(new Date(Date.UTC(year, month - 1, day)));
            setSearchAnchor(null);
          }}
        />
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
  onEditHours,
  crudEnabled,
  onManageCalendars,
}: {
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  calendars: CalendarLegendGroup[];
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  roleBuckets: { key: string; label: string; hours: number }[];
  excludedRoleKeys: Set<string>;
  toggleRoleKey: (key: string) => void;
  classesEnabled: boolean;
  classCount: number;
  localClassCount: number;
  onManageClasses: () => void;
  onEditHours: (anchor: DOMRect) => void;
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
            {/* Working-hours editor opens inline, anchored to this row. */}
            {spec.key === "workingHours" && (
              <div className="mb-1 ml-8 mt-0.5">
                <button
                  type="button"
                  onClick={(e) => onEditHours(e.currentTarget.getBoundingClientRect())}
                  className="text-xs font-medium text-accent-teal hover:underline"
                >
                  Edit hours
                </button>
              </div>
            )}
            {/* Per-calendar visibility toggles under Linked calendars, grouped by
                account (headers shown only when more than one is linked). */}
            {spec.key === "external" && on && calendars.length > 0 && (
              <div className="mb-1 ml-8 mt-0.5 flex flex-col gap-1.5">
                {calendars.map((group) => (
                  <div key={group.account} className="flex flex-col gap-0.5">
                    {calendars.length > 1 && (
                      <div className="truncate px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.account}
                      </div>
                    )}
                    {group.calendars.map((c) => {
                      const hidden = hiddenCals.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleHiddenCal(c.id)}
                          aria-pressed={!hidden}
                          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                        >
                          <span
                            className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", hidden && "opacity-30")}
                            style={{ backgroundColor: c.color ?? "var(--color-accent-coral)" }}
                          />
                          <span className={cn("truncate", hidden ? "text-muted-foreground line-through" : "text-foreground")}>
                            {c.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {/* Enabling which calendars sync lives in global Settings. */}
                <a
                  href="/settings/calendar"
                  target="_top"
                  rel="noopener"
                  className="px-1 pt-0.5 text-[11px] font-medium text-accent-teal hover:underline"
                >
                  Manage accounts & calendars →
                </a>
              </div>
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
    {crudEnabled && (
      <div className="mt-1 border-t border-border pt-1">
        <button
          type="button"
          onClick={onManageCalendars}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CalendarDays className="h-3.5 w-3.5" /> Manage calendars
        </button>
      </div>
    )}
    </>
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



