import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  CalendarDays,
  CalendarPlus,
  Search,
  X,
} from "lucide-react";
import { fullName } from "~/lib/display";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { getZonedYMD, zonedWallTimeUtc } from "~/lib/timezone";
import {
  EventComposer,
  CalendarSearchBar,
  WorkingHoursPopover,
  CalendarManagerModal,
  ClassesManagerModal,
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
import { cn } from "~/lib/cn";
import type {
  WhDay,
  CalendarLinkDTO,
  GroupOption,
  UserOption,
  ProjectOption,
  TimeEntryDTO,
  MemberClassDTO,
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
  ADD_EVENT_BTN, EVENT_TEXT, AVAIL_DEEP_GREEN, availabilityTint,
  HOURS, HOUR_PX, SUBDIVISIONS_PER_HOUR, SNAP_HOURS,
  DAY_KEYS,
  toDatetimeLocal, dayHourToLocal,
  ROLE_COLOR_PALETTE, roleColor,
  readableTextColor,
  formatHour, formatHourMinute, shiftWeekParam,
} from "~/calendar/lib/event-block";
import {
  WeekGrid, WeekGridEvent, useNow, useRefreshOnFocus,
  workingHoursStripeLayer, DayBg, BlockBlock,
  SelectionPopoverPortal,
  type AllDayBlock,
} from "~/calendar/components/WeekGrid";
import {
  buildExternalLayer,
  buildLoggedSourceIndex,
  buildAllDayItems,
  buildAllDayLayer,
  buildLoggedTimeLayer,
  workEventsOnly,
  mergeLayers,
  perCalendarLegend,
  type CalendarLegendGroup,
  computeRoleBuckets,
  timeEntryRange,
  toGridRange,
  DEFAULT_LAYER_VISIBILITY,
  type LayerVisibility,
} from "~/calendar/lib/layers";
import { useCalendarView, ymdUtc } from "~/calendar/lib/use-calendar-view";
import { MonthGrid } from "~/calendar/components/MonthGrid";
import { AgendaView } from "~/calendar/components/AgendaView";
import {
  GeneralCalendarPrompt,
} from "~/calendar/components/settings-cards";
import { MeetingComposer, type AddingMode, ParticipantPicker, userLabel } from "~/calendar/components/scheduling";
import { CreateEventModal } from "~/calendar/components/CreateEventModal";
import { CalendarsPanel } from "~/calendar/components/CalendarsPanel";
import { TimesheetSummaryRail, TimesheetEditPopover, TimesheetDragPopover, LogHoursDialog } from "~/calendar/components/timesheet";
import { AvailabilityView } from "~/calendar/components/AvailabilityView";
import { CalendarSidebar } from "~/calendar/components/CalendarSidebar";
import { useIsMobile } from "~/hooks/useIsMobile";

// Underline subnav sits flush under the workspace tab bar (see layout embed padding).
// `areaSubnav` (not `areaPills`) because calendar renders its own day/week/month
// UnderlineTabButtons row unconditionally — it isn't the flag-gated AreaPillNav,
// so it reserves the flush top spacing regardless of the sidebar-redesign flag.
export const handle = {
  areaSubnav: true,
  docKey: "calendar",
  docTitle: "Calendar",
  // Fill the shell pane (iframe or tabless column) so the grid stretches to
  // the edges and hours scroll inside it instead of the page.
  fitViewport: true,
  flushPane: true,
};

export async function loader({ request }: Route.LoaderArgs) { return loadCalendarData(request); }

export async function action({ request }: Route.ActionArgs) { return submitCalendarAction(request); }

/**
 * Month / week / day are now computed on the client from the URL (see
 * `viewWindow` use below), and the loader already fetches a window wider than
 * any single view, so when `view` is the only thing that moved there is nothing
 * new to load. Skipping the revalidation is what makes the toggle repaint
 * immediately instead of waiting on a Google round-trip.
 *
 * `doc` / `comment` are the page-guide's URL state (PageDocProvider writes them
 * on open/close). Closing the guide is a same-page navigation, so without this
 * the loader would re-run — you'd land back on the calendar watching it refetch
 * Google.
 *
 * Anything else — a different anchor, a new week — still revalidates.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) {
  // A mutation leaves the URL untouched (every action on this screen posts to
  // the current location), so the search-param comparison below would read it
  // as "nothing changed" and skip the loader — leaving the just-created event
  // or time entry off the grid until the next window focus. Anything that
  // isn't a plain GET defers to the default, which is to revalidate.
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const cur = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  for (const key of ["view", "doc", "comment"]) {
    cur.delete(key);
    next.delete(key);
  }
  cur.sort();
  next.sort();
  return cur.toString() === next.toString() ? false : defaultShouldRevalidate;
}

/** The shell both of the calendar's settings dialogs wear — Calendars and
 *  Availability — so they read as one surface with two bodies. Only the width
 *  varies, and only because the bodies do. */
function SettingsDialog({
  title,
  width = "max-w-3xl",
  onClose,
  children,
}: {
  title: string;
  width?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 backdrop-blur-sm p-4 py-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("w-full rounded-xl cal-surface p-6", width)}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  return <CalendarScreen data={data} />;
}

/* ------------------------------------------------------------------ */
/* Calendar. The screen always renders; the `calendar-unified` flag gates the   */
/* full feature set (Google event CRUD, meeting scheduling, classes, timesheet). */
/* ------------------------------------------------------------------ */

const CALENDAR_LAYERS_KEY = "dali:calendar:layers";
const CALENDAR_HIDDEN_CALS_KEY = "dali:calendar:hiddenCals";
const CALENDAR_ROLE_COLORS_KEY = "dali:calendar:roleColors";
const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day", agenda: "Agenda" };

// One screen, three views, toggleable colored layers. Scheduling and timesheet
// are reachable from the Create menu (they reuse the existing Schedule/Timesheet
// UIs); day-to-day browsing is the layered grid. Deep links from the old tabs
// (?tab=schedule|timesheet) translate to the matching mode/layer.
function CalendarScreen({ data }: { data: LoaderData }) {
  const { panel } = useOsChrome();
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  useRefreshOnFocus(refresh);
  const [searchParams] = useSearchParams();

  // One screen now. Availability is a modal and the timesheet is a way of
  // viewing the same grid, so the only other "mode" left is the legacy
  // meeting-scheduling deep link.
  const [mode, setMode] = useState<"browse" | "meeting">(() =>
    searchParams.get("tab") === "schedule" ? "meeting" : "browse",
  );
  const [availabilityOpen, setAvailabilityOpen] = useState(false);

  // Per-role colours for logged time, persisted like the hidden-calendar set.
  const [roleColors, setRoleColors] = useState<Record<string, string>>(() => {
    try {
      const stored = window.localStorage.getItem(CALENDAR_ROLE_COLORS_KEY);
      if (stored) return JSON.parse(stored) as Record<string, string>;
    } catch {
      /* ignore */
    }
    return {};
  });
  const setRoleColor = (roleKey: string, hex: string) =>
    setRoleColors((prev) => {
      const next = { ...prev, [roleKey]: hex };
      try {
        window.localStorage.setItem(CALENDAR_ROLE_COLORS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const [layers, setLayers] = useState<LayerVisibility>(() => {
    const base: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
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

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalSlot, setCreateModalSlot] = useState<{ startLocal: string; endLocal: string } | null>(null);
  // Guests the modal opens with — the sidebar's "Meet with" seeds one person.
  const [createModalUsers, setCreateModalUsers] = useState<string[]>([]);
  // Every create path (grid drag, New button) lands here. Passing no slot opens
  // the modal on its own defaults.
  const openCreateModal = (startLocal?: string, endLocal?: string, userIds: string[] = []) => {
    setCreateModalSlot(startLocal && endLocal ? { startLocal, endLocal } : null);
    setCreateModalUsers(userIds);
    setCreateModalOpen(true);
  };
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  // Search bar (anchored to its toolbar button). Null anchor = closed.
  const [searchAnchor, setSearchAnchor] = useState<DOMRect | null>(null);
  // Anchored popover that replaced the old settings modal: working-hours edit
  // (from the layer row). Null anchor = closed.
  const [hoursAnchor, setHoursAnchor] = useState<DOMRect | null>(null);
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
  // Detail-popover Duplicate: open the composer in create mode, prefilled from
  // the event (a fresh event — identity fields are dropped).
  const duplicateEvent = (e: ExternalEventDTO, anchor?: DOMRect) =>
    setComposer({ mode: "create", anchor, seed: e });
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
        scope: "this",
        recurringEventId: "",
        originalStartIso: e.startIso ?? "",
      },
      { method: "post" },
    );
  };
  // The grid's timesheet slot. In timesheet mode the grid logs hours directly:
  // clicking a logged block edits it, and dragging out an empty slot creates an
  // entry with no event behind it. With the timesheet layer off, dragging opens
  // the event modal instead and this slot is only ever the editor.
  type TimesheetSelection = { dayIdx: number; startHour: number; endHour: number; startLocal: string; endLocal: string } & (
    | { mode: "edit"; entry: TimeEntryDTO }
    | { mode: "create" }
  );
  const [timesheetSel, setTimesheetSel] = useState<TimesheetSelection | null>(null);
  // The Log hours button's dialog. Separate from timesheetSel because it has no
  // grid slot: it carries only the times its form opens on.
  const [logHours, setLogHours] = useState<{ startLocal: string; endLocal: string } | null>(null);

  // Derived on the client, not read off the loader. The window maths is shared
  // with the server (lib/view-window.ts), so switching month / week / day
  // repaints from data already in hand instead of waiting for a round-trip that
  // goes out to Google. Shared with the Core hub, which draws the same grids.
  const {
    view,
    rangeStart,
    rangeEnd,
    days,
    focusDate,
    anchorMonth,
    rangeLabel,
    changeView,
    navigate,
    goToday,
    goToDay,
  } = useCalendarView(data.timezone);
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();

  // On mobile, default to "day" view so the single-column layout is usable
  // without horizontal scrolling through a compressed 7-day week grid.
  const isMobile = useIsMobile();
  useEffect(() => {
    if (isMobile && view === "week") changeView("day");
  // Only run when isMobile first becomes true (post-mount). Don't chase every
  // view change the user makes — they should be able to switch back to week.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Keyboard nav (Google-Calendar style): D/W/M switch view, T jumps to today,
  // ←/→ page. Only in browse mode, never while a dialog is open or while typing
  // into a field. Modifier chords are left for the browser/OS.
  const anyModalOpen =
    Boolean(composer) ||
    Boolean(timesheetSel) ||
    Boolean(logHours) ||
    classesOpen ||
    calMgrOpen ||
    createModalOpen ||
    Boolean(searchAnchor) ||
    Boolean(hoursAnchor);
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
  }, [mode, anyModalOpen, view, rangeStartIso]); // eslint-disable-line react-hooks/exhaustive-deps

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
      }
    : data;

  // Hours logged against something the event layer already draws — a meeting,
  // or an event marked as work. Those annotate their source block with a role
  // accent rather than drawing a second block on top of it, so there's one
  // block, and one click target, per thing.
  const loggedSources = buildLoggedSourceIndex(data, excludedRoleKeys, roleColors);

  // "View timesheet" is a way of *looking* at the grid, not another overlay:
  // it answers "what did I work on", so an ordinary calendar event — a class, a
  // dentist appointment, a meeting nobody logged — has no place on it. What
  // stays is the logged entries themselves and the events those hours were
  // logged against, which keep drawing here (wearing their role accent) so the
  // one block is still the event's own click target.
  const workOnly = layers.logged;
  const eventData = workOnly ? workEventsOnly(layerData, loggedSources.byEvent) : layerData;

  const layerMaps: Record<number, EventBlock[]>[] = [];
  if (layers.external)
    layerMaps.push(
      buildExternalLayer(
        eventData,
        days,
        hiddenCals,
        data.crudEnabled ? (e, anchor) => setComposer({ mode: "edit", event: e, anchor }) : undefined,
        data.crudEnabled ? moveEvent : undefined,
        data.crudEnabled ? duplicateEvent : undefined,
        data.crudEnabled ? deleteEvent : undefined,
        layers.logged ? loggedSources.byEvent : undefined,
      ),
    );
  // All-day events (crud read) render in the grid's all-day band.
  const allDayByDay: Record<number, AllDayBlock[]> = {};
  if (data.crudEnabled) {
    const items = buildAllDayItems(eventData, days, hiddenCals);
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
  if (layers.logged)
    layerMaps.push(
      buildLoggedTimeLayer(data, days, {
        excludedRoleKeys,
        // Suppress the duplicate block for entries the event layer is already
        // drawing (meetings, and events marked as work) — otherwise the logged
        // block lands on top of the event's own block and swallows the click,
        // leaving no way to open the event and edit its details. Those blocks
        // carry a role accent instead. With the event layer off there is
        // nothing underneath, so the logged block is still needed.
        roleColors,
        // Events only carry an eventId (and so can wear an accent) on the crud
        // read; without the flag the busy read has nothing to annotate, so the
        // entry has to keep drawing its own block or the hours vanish.
        suppressSourced: {
          // A meeting's own calendar event isn't marked as work, so in
          // timesheet view it's filtered off the grid — nothing is left to
          // carry the accent, and the entry has to draw its own block or the
          // hours vanish from the one view that exists to show them.
          meetings: !workOnly && layers.external,
          events: layers.external && data.crudEnabled,
        },
        onEntryClick: (t, startIso, endIso) => {
          const { dayIdx, startHour, endHour } = toGridRange(days, data.timezone, startIso, endIso);
          const day = days[dayIdx];
          if (!day) return;
          setTimesheetSel({
            mode: "edit",
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
  // Month & agenda have no all-day band, so fold all-day events into the shared
  // EventBlock map there as full-width chips / "All day" rows. Week/day show them
  // in the dedicated band (allDayByDay) instead — don't double them up.
  if (layers.external && data.crudEnabled && (view === "month" || view === "agenda"))
    layerMaps.push(
      buildAllDayLayer(eventData, days, hiddenCals, (e, anchor) =>
        setComposer({ mode: "edit", event: e, anchor }),
      ),
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
  const rangeEndMs = rangeEnd.getTime();
  const drawnEntries = data.timeEntries.filter((t) => {
    const start = new Date(timeEntryRange(t, data.timezone).startIso).getTime();
    return start >= rangeStart.getTime() && start < rangeEndMs;
  });
  const roleBuckets = computeRoleBuckets(data, periodEntries, drawnEntries);
  // Pay-period hours per role, for the sidebar's role list.
  const roleHours = Object.fromEntries(roleBuckets.map((b) => [b.key, b.hours]));

  // In timesheet mode the grid logs hours, so the create paths land on the
  // timesheet popover instead of the event modal — an entry with no event
  // behind it, which is the whole point of logging straight onto the grid.
  // The popover anchors to a slot, so it needs a view that draws one; month and
  // agenda keep the event modal.
  const timesheetCreateMode = layers.logged && (view === "week" || view === "day");

  // A sensible default slot for the Add button, which has no drag to seed it:
  // today if it's in range, else the first visible day, 9am for the user's
  // default duration.
  const defaultSlot = () => {
    const nowKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const found = days.findIndex((d) => ymdUtc(d.dateUtc) === nowKey);
    const dayIdx = found >= 0 ? found : 0;
    const day = days[dayIdx];
    if (!day) return null;
    const endHour = 9 + data.defaultEventDurationMin / 60;
    return {
      dayIdx,
      startHour: 9,
      endHour,
      startLocal: dayHourToLocal(day.dateUtc, 9),
      endLocal: dayHourToLocal(day.dateUtc, endHour),
    };
  };

  // Every create path funnels through here: grid drag, and the Add button
  // (which passes no slot and falls back to the default one).
  const startCreate = (slot?: { dayIdx: number; startHour: number; endHour: number; startLocal: string; endLocal: string }) => {
    if (!timesheetCreateMode) {
      openCreateModal(slot?.startLocal, slot?.endLocal);
      return;
    }
    // A drag names its own slot, so its form belongs on that slot — the popover
    // is anchored to the block you just drew. The button names none: pinning
    // its form to a default slot put the dialog somewhere the user never
    // pointed at (and drew a phantom selection on the grid), so it opens
    // centered instead.
    if (slot) {
      setTimesheetSel({ mode: "create", ...slot });
      return;
    }
    const resolved = defaultSlot();
    if (!resolved) return;
    setLogHours({ startLocal: resolved.startLocal, endLocal: resolved.endLocal });
  };

  const navBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  const iconToolBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium text-foreground hover:bg-muted";
  // The two settings dialogs open from the same pill, tinted by what they are:
  // Availability is a status colour, Calendars the os accent. One builder so
  // they can't drift into two different-looking controls.
  const settingsPill = (tone: "green" | "accent") =>
    cn(
      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-bold transition-colors",
      tone === "green"
        ? "border-os-green/35 bg-os-green/10 text-os-green hover:bg-os-green/20"
        : "border-os-accent/35 bg-os-accent/10 text-os-accent hover:bg-os-accent/20",
    );

  return (
    <div className="flex w-full min-h-0 flex-1 flex-col gap-3">
      {/* The date navigator belongs to the grid. Availability has no date at
          all, and Timesheet brings its own pay-period navigator, so neither
          wants this row above it. */}
      {mode === "browse" && (
      <header className="flex shrink-0 flex-wrap items-center gap-3">
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

              <button
                type="button"
                onClick={() => setCalendarsOpen(true)}
                className={settingsPill("accent")}
                title="Connect and manage calendars"
              >
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
                Calendars
              </button>

              <button
                type="button"
                onClick={() => setAvailabilityOpen(true)}
                className={settingsPill("green")}
                title="Classes and working hours"
              >
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
                Availability
              </button>

              <button type="button" onClick={() => startCreate()} className={ADD_EVENT_BTN}>
                <Plus className="h-4 w-4 stroke-[3]" />
                {timesheetCreateMode ? "Log hours" : "Add event"}
              </button>
            </>
          )}
        </div>
      </header>
      )}

      {/* The composer is a form, not a grid: it can run taller than the window,
          so inside a viewport-bounded shell it carries its own scrollport
          rather than overflowing one it doesn't own. */}
      {mode === "meeting" ? (
        <section className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-y-auto">
          <BackToCalendarBar label="Schedule a meeting" onBack={() => setMode("browse")} />
          <MeetingComposer data={data} />
        </section>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 gap-5 max-md:min-h-[22rem]">
          <CalendarSidebar
            data={data}
            focusDate={focusDate}
            onPickDate={goToDay}
            hiddenCals={hiddenCals}
            toggleHiddenCal={toggleHiddenCal}
            layers={layers}
            onToggleTimesheet={() => toggleLayer("logged")}
            myRoles={data.myRoles}
            roleColors={roleColors}
            roleHours={roleHours}
            setRoleColor={setRoleColor}
            onMeetWith={(userId) => openCreateModal(undefined, undefined, [userId])}
          />
          {/* No card around the grid — the hour rules and day rules are the
              only structure it needs, the way Google's week view reads.
              overflow-x-auto lets the min-w-[640px] WeekGrid scroll rather
              than compress on narrow viewports. */}
          <section className="flex min-w-0 flex-1 flex-col md:min-h-0 overflow-x-auto">
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
                  onDayPointerSelect={(dayIdx, startHour, endHour) => {
                    const day = days[dayIdx];
                    if (!day) return;
                    startCreate({
                      dayIdx,
                      startHour,
                      endHour,
                      startLocal: dayHourToLocal(day.dateUtc, startHour),
                      endLocal: dayHourToLocal(day.dateUtc, endHour),
                    });
                  }}
                  selection={
                    timesheetSel
                      ? { dayIdx: timesheetSel.dayIdx, startHour: timesheetSel.startHour, endHour: timesheetSel.endHour }
                      : createSel
                  }
                  selectionPopover={
                    timesheetSel
                      ? () =>
                          timesheetSel.mode === "create" ? (
                            <TimesheetDragPopover
                              startLocal={timesheetSel.startLocal}
                              endLocal={timesheetSel.endLocal}
                              myRoles={data.myRoles}
                              onClose={() => setTimesheetSel(null)}
                            />
                          ) : (
                            <TimesheetEditPopover
                              entry={timesheetSel.entry}
                              startLocal={timesheetSel.startLocal}
                              endLocal={timesheetSel.endLocal}
                              myRoles={data.myRoles}
                              onClose={() => setTimesheetSel(null)}
                            />
                          )
                      : undefined
                  }
                  onSelectionDismiss={() => setTimesheetSel(null)}
                  // Only the timesheet selection resizes — both its popovers
                  // follow startLocal/endLocal live. The crud create preview
                  // (createSel) is a static hint driven by the composer.
                  onSelectionResize={
                    timesheetSel
                      ? (startHour, endHour) =>
                          setTimesheetSel((prev) => {
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
        </div>
      )}
      {logHours && (
        <LogHoursDialog
          startLocal={logHours.startLocal}
          endLocal={logHours.endLocal}
          myRoles={data.myRoles}
          onClose={() => setLogHours(null)}
        />
      )}
      {hoursAnchor && (
        <WorkingHoursPopover data={data} anchor={hoursAnchor} onClose={() => setHoursAnchor(null)} />
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
          rangeStartIso={rangeStartIso}
          rangeEndIso={rangeEndIso}
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
      {calendarsOpen &&
        createPortal(
          /* Wider than Availability: its rows carry a name plus three toggle
             columns, where Availability stacks full-width cards. Same shell
             either way — width follows the body, the dress doesn't. */
          <SettingsDialog title="Calendars" width="max-w-5xl" onClose={() => setCalendarsOpen(false)}>
            <CalendarsPanel data={data} hiddenCals={hiddenCals} toggleHiddenCal={toggleHiddenCal} />
          </SettingsDialog>,
          document.body,
        )}
      {availabilityOpen &&
        createPortal(
          <SettingsDialog title="Availability" onClose={() => setAvailabilityOpen(false)}>
            <AvailabilityView data={data} />
          </SettingsDialog>,
          document.body,
        )}
      {createModalOpen && (
        <CreateEventModal
          data={data}
          startLocal={createModalSlot?.startLocal}
          endLocal={createModalSlot?.endLocal}
          initialUserIds={createModalUsers}
          onClose={() => {
            setCreateModalOpen(false);
            setCreateModalSlot(null);
            setCreateModalUsers([]);
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
