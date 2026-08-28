import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  CalendarDays,
  CalendarPlus,
  Settings,
  SlidersHorizontal,
  Search,
} from "lucide-react";
import { fullName } from "~/lib/display";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { getZonedYMD, zonedWallTimeUtc } from "~/lib/timezone";
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
import type { Route } from "./+types/calendar";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { RsvpButtons } from "~/components/RsvpButtons";
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
  EVENT_TEXT, AVAIL_DEEP_GREEN, availabilityTint,
  HOURS, HOUR_PX, INITIAL_SCROLL_HOUR, SUBDIVISIONS_PER_HOUR, SNAP_HOURS,
  RSVP_BADGE, DAY_KEYS, ATTENDEE_DOT, GUESTS_COLLAPSED,
  toDatetimeLocal, dayHourToLocal,
  ROLE_COLOR_PALETTE, roleColor,
  readableTextColor,
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
  GeneralCalendarPrompt,
} from "~/calendar/components/settings-cards";
import { MeetingComposer, type AddingMode, ParticipantPicker, ParticipantAvailabilityRoster, SelectedSlotBlock, SlotAttendeePopover, userLabel } from "~/calendar/components/scheduling";
import { CreateEventModal } from "~/calendar/components/CreateEventModal";
import { CalendarsPanel } from "~/calendar/components/CalendarsPanel";
import { TimesheetSummaryRail, TimesheetView, CreateFromDragPopover, TimesheetEditPopover } from "~/calendar/components/timesheet";
import { LegacyCalendarTabs } from "~/calendar/components/legacy-tabs";

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


export default function CalendarPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const unified = useFeatureFlag("calendar-unified");
  return unified ? <CalendarScreen data={data} /> : <LegacyCalendarTabs data={data} />;
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalSlot, setCreateModalSlot] = useState<{ startLocal: string; endLocal: string } | null>(null);
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
    createModalOpen ||
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
                  <div className="absolute right-0 z-50 mt-1">
                    <CalendarsPanel
                      data={data}
                      layers={layers}
                      toggleLayer={toggleLayer}
                      hiddenCals={hiddenCals}
                      toggleHiddenCal={toggleHiddenCal}
                      classesEnabled={data.classesEnabled}
                      timesheetSyncEnabled={data.timesheetGoogleSync}
                      onClose={() => setCalendarsOpen(false)}
                    />
                  </div>
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
                    // Single "Create event or meeting" button opens the unified modal.
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      onClick={() => {
                        setCreateModalSlot(null);
                        setCreateModalOpen(true);
                        setCreateOpen(false);
                      }}
                    >
                      <CalendarPlus className="h-4 w-4 text-muted-foreground" /> Create event or meeting
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
                    // With Google CRUD on, dragging opens the unified create modal.
                    if (data.crudEnabled) {
                      setCreateModalSlot({ startLocal, endLocal });
                      setCreateModalOpen(true);
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
      {createModalOpen && (
        <CreateEventModal
          data={data}
          startLocal={createModalSlot?.startLocal}
          endLocal={createModalSlot?.endLocal}
          onClose={() => {
            setCreateModalOpen(false);
            setCreateModalSlot(null);
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

