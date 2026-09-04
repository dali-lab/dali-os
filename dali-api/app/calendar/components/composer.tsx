import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  Calendar as CalendarIcon,
  Clock,
  X,
  GripVertical,
  Repeat,
  MapPin,
  AlignLeft,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { AnchoredPopover } from "~/calendar/components/AnchoredPopover";
import { WorkingHoursCard } from "~/calendar/components/settings-cards";
import { DateField } from "~/components/ui/DateField";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import { getZonedYMD } from "~/lib/timezone";
import { cn } from "~/lib/cn";
import { localDayTimeToIso } from "~/calendar/lib/event-block";
import { DARTMOUTH_PERIODS, getPeriod, periodSummary } from "~/calendar/lib/dartmouth-periods";
import { destinationValue, classScheduleSummary } from "~/calendar/lib/class-format";
import type { CalendarSearchHit } from "~/calendar/lib/search";
import type {
  LoaderData,
  ExternalEventDTO,
  MemberClassDTO,
} from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────

const dtPad = (n: number) => String(n).padStart(2, "0");

// ISO instant → { date:"YYYY-MM-DD", time:"HH:mm" } as wall-clock in `timezone`,
// so the composer's fields match where the grid actually places the event. The
// grid renders in the user's configured timezone, which may differ from the
// browser's — reading the instant with getHours() (browser-local) would drift.
export function isoToZonedFields(iso: string, timezone: string): { date: string; time: string } {
  const { year, month, day } = getZonedYMD(new Date(iso), timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  let hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  if (hh === "24") hh = "00"; // some ICU builds render midnight as "24"
  return { date: `${year}-${dtPad(month)}-${dtPad(day)}`, time: `${hh}:${mm}` };
}

export function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10); // all-day = UTC-midnight date
}

export function addDaysToDate(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Where a new event can go: any writable Google calendar. */
export function eventDestinations(data: LoaderData): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
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
export function currentDestinationValue(c: MemberClassDTO): string {
  if (c.storage === "Local" || !c.linkId) return "local";
  if (!c.calendarId || c.calendarId === "primary") return `google:${c.linkId}:primary`;
  return `google:${c.linkId}:cal:${c.calendarId}`;
}

// ── ComposerState type ─────────────────────────────────────────────────────

export type ComposerState =
  // anchor is the on-screen rect of the clicked event / dragged slot / New
  // button, so the composer pops up next to it (Google-Calendar style) rather
  // than as a centered full-screen modal. Null → centered fallback. seed
  // prefills a create from an existing event (Duplicate) — its identity fields
  // (eventId/manualBlockId) are ignored, so it saves as a brand-new event.
  | { mode: "create"; startLocal?: string; endLocal?: string; anchor?: DOMRect | null; seed?: ExternalEventDTO }
  | { mode: "edit"; event: ExternalEventDTO; anchor?: DOMRect | null };

// ── SearchResponse type ────────────────────────────────────────────────────

type SearchResponse = {
  local: CalendarSearchHit[];
  google: CalendarSearchHit[];
  googleError: string | null;
  scope: "near" | "all";
};

// ── CalendarSearchBar ──────────────────────────────────────────────────────

export function CalendarSearchBar({
  anchor,
  rangeStartIso,
  rangeEndIso,
  timezone,
  onClose,
  onSelect,
}: {
  anchor: DOMRect;
  rangeStartIso: string;
  rangeEndIso: string;
  timezone: string;
  onClose: () => void;
  onSelect: (hit: CalendarSearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"near" | "all">("near");
  const fetcher = useFetcher<SearchResponse>();

  const query = q.trim();
  const hasQuery = query.length >= 2;

  // Debounced load; re-fires when the query or the (widened) scope changes.
  useEffect(() => {
    if (query.length < 2) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        scope,
        rangeStart: rangeStartIso,
        rangeEnd: rangeEndIso,
      });
      fetcher.load(`/api/calendar/search?${params.toString()}`);
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, rangeStartIso, rangeEndIso]);

  const loading = fetcher.state !== "idle";
  const local = fetcher.data?.local ?? [];
  const google = fetcher.data?.google ?? [];
  const googleError = fetcher.data?.googleError ?? null;
  const settled = hasQuery && !loading && Boolean(fetcher.data);
  const nothing = settled && local.length === 0 && google.length === 0;

  const now = new Date();
  const fmtWhen = (hit: CalendarSearchHit) => {
    const d = new Date(hit.startIso);
    const sameYear =
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(d) ===
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(now);
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(d);
    if (hit.allDay) return dateStr;
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
    return `${dateStr} · ${timeStr}`;
  };

  const iconFor = (source: CalendarSearchHit["source"]) =>
    source === "meeting" ? UsersRound : source === "block" ? Clock : CalendarIcon;

  const renderHit = (hit: CalendarSearchHit) => {
    const Icon = iconFor(hit.source);
    return (
      <button
        key={hit.id}
        type="button"
        onClick={() => onSelect(hit)}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{hit.title}</span>
            {hit.recurring && (
              <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Repeats" />
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {fmtWhen(hit)}
            {hit.location ? ` · ${hit.location}` : ""}
          </span>
        </span>
      </button>
    );
  };

  return (
    <AnchoredPopover
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Search events"
      className="flex max-h-[70vh] w-[26rem] flex-col overflow-hidden rounded-xl cal-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setScope("near"); // a new query resets to the cheap near window
          }}
          placeholder="Search events…"
          aria-label="Search events"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {loading && <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!hasQuery && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Search your events by title. Your calendar is searched across all time; Google is scoped
            to nearby weeks.
          </p>
        )}
        {nothing && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No events match "{query}".
          </p>
        )}

        {local.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your calendar
            </p>
            {local.map(renderHit)}
          </div>
        )}

        {google.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Google
            </p>
            {google.map(renderHit)}
          </div>
        )}

        {hasQuery && !loading && scope === "near" && (
          <button
            type="button"
            onClick={() => setScope("all")}
            className="mt-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-accent-teal hover:bg-muted"
          >
            Search all Google calendars →
          </button>
        )}
        {scope === "all" && !loading && (
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">Showing all Google results.</p>
        )}
        {googleError && (
          <p className="px-2 pt-1 text-[11px] text-muted-foreground">Couldn't reach Google.</p>
        )}
      </div>
    </AnchoredPopover>
  );
}

// ── WorkingHoursPopover ────────────────────────────────────────────────────

export function WorkingHoursPopover({
  data,
  anchor,
  onClose,
}: {
  data: LoaderData;
  anchor: DOMRect;
  onClose: () => void;
}) {
  return (
    <AnchoredPopover
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Working hours"
      className="w-[25rem] max-h-[80vh] overflow-y-auto rounded-xl cal-surface p-4"
    >
      <WorkingHoursCard workingHours={data.workingHours} hasPersisted={data.hasPersistedWorkingHours} />
    </AnchoredPopover>
  );
}

// ── EventComposer ──────────────────────────────────────────────────────────
// Create / edit / delete a Google Calendar event. Recurrence-create is deferred
// (single events for now); editing patches this event/occurrence's fields.

export function EventComposer({
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
    if (base?.linkId && base.calendarId) return `${base.linkId}:${base.calendarId}`;
    if (data.defaultEventDest && dests.some((d) => d.value === data.defaultEventDest)) return data.defaultEventDest;
    return dests[0]?.value ?? "";
  });
  const [location, setLocation] = useState(base?.location ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  // A recurring instance carries recurringEventId; editing it prompts for scope.
  const isRecurring = Boolean(ev?.recurringEventId);
  const [scope, setScope] = useState<"this" | "following" | "all">("this");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Timed inputs are split into one date + start/end times (custom DateField /
  // TimeField), seeded as wall-clock in the user's timezone (the grid's) so the
  // composer and the on-grid block agree even when the browser timezone differs.
  // The drag seed (state.startLocal, "yyyy-MM-ddThh:mm") is already wall-clock.
  const seedTimed =
    base && !base.allDay
      ? { start: isoToZonedFields(base.startIso, data.timezone), end: isoToZonedFields(base.endIso, data.timezone) }
      : null;
  const createSeed = state.mode === "create" ? { s: state.startLocal, e: state.endLocal } : null;
  const initStart = seedTimed?.start ?? { date: createSeed?.s?.slice(0, 10) ?? "", time: createSeed?.s?.slice(11, 16) ?? "" };
  const initEnd = seedTimed?.end ?? { date: createSeed?.e?.slice(0, 10) ?? "", time: createSeed?.e?.slice(11, 16) ?? "" };
  const [date, setDate] = useState(initStart.date);
  const [startTime, setStartTime] = useState(initStart.time);
  const [endTime, setEndTime] = useState(initEnd.time);
  const [dStart, setDStart] = useState(base?.allDay ? isoToDateInput(base.startIso) : initStart.date);
  const [dEnd, setDEnd] = useState(
    base?.allDay ? addDaysToDate(isoToDateInput(base.endIso), -1) : initEnd.date,
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
  // that's earlier than the start is read as crossing midnight (next day). Times
  // are interpreted in the user's timezone (data.timezone) via localDayTimeToIso
  // — NOT the browser's — so a typed "9:00" lands where the grid draws 9:00.
  const startLocalDT = date && startTime ? `${date}T${startTime}` : ""; // RepeatField anchor
  const endDate = date && startTime && endTime && endTime < startTime ? addDaysToDate(date, 1) : date;
  const startIso = allDay
    ? dStart
      ? `${dStart}T00:00:00.000Z`
      : ""
    : date && startTime
      ? localDayTimeToIso(date, startTime, data.timezone) ?? ""
      : "";
  const endIso = allDay
    ? dEnd
      ? `${addDaysToDate(dEnd, 1)}T00:00:00.000Z` // Google end is exclusive
      : ""
    : endDate && endTime
      ? localDayTimeToIso(endDate, endTime, data.timezone) ?? ""
      : "";
  const canSubmit =
    title.trim() !== "" &&
    destination !== "" &&
    startIso !== "" &&
    endIso !== "" &&
    startIso < endIso;
  const submitting = fetcher.state !== "idle" || deleteFetcher.state !== "idle";

  // Report the draft times to the grid so the live preview (a tentative block
  // when creating, or the edited event's own block when editing) tracks edits.
  useEffect(() => {
    onDraftChange?.(startIso, endIso, allDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, endIso, allDay]);

  const fieldCls = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

  return (
    <AnchoredPopover
      anchor={state.anchor}
      onClose={onClose}
      draggable
      ariaLabel={editing ? "Edit event" : "New event"}
      className="w-[23rem] max-h-[85vh] overflow-y-auto rounded-xl cal-surface"
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
          <fetcher.Form method="post" className="flex flex-col gap-3 px-4 py-4">
            <input type="hidden" name="intent" value={editing ? "event-update" : "event-create"} />
            {editing && ev?.eventId && <input type="hidden" name="eventId" value={ev.eventId} />}
            <input type="hidden" name="destination" value={destination} />
            <input type="hidden" name="startIso" value={startIso} />
            <input type="hidden" name="endIso" value={endIso} />
            <input type="hidden" name="allDay" value={allDay ? "1" : ""} />
            <input type="hidden" name="timeZone" value={data.timezone} />
            <input type="hidden" name="recurrenceRule" value={!isRecurring ? (repeatSpecToRRule(repeat, allDay ? dStart : startLocalDT) ?? "") : ""} />
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
              className="rounded-md border border-border bg-background px-3 py-2 text-base font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-os-accent focus:outline-none"
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
                          scope === s ? "bg-os-accent text-os-bg" : "text-foreground hover:bg-muted",
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-os-accent-hover disabled:opacity-50"
              >
                {editing ? "Save" : "Create event"}
              </button>
              {editing && ev?.writable && ev.eventId && (
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

// ── CalendarManagerModal ───────────────────────────────────────────────────
// Create / rename / delete Google calendars on a linked account.

export function CalendarManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 backdrop-blur-sm p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-label="Manage calendars" className="relative z-10 w-full max-w-md rounded-xl cal-surface p-5">
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
                className="w-fit rounded-lg bg-os-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-os-accent-hover disabled:opacity-50"
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

// ── ClassesManagerModal ────────────────────────────────────────────────────
// "My classes this term" — add Dartmouth classes (period picker or custom time)
// to the calendar, synced to a linked Google calendar or kept as a DALI layer.

// The classes editor itself. Rendered inline by the Availability tab, and
// wrapped by ClassesManagerModal for the places that still open it as a dialog.
export function ClassesManagerBody({ data }: { data: LoaderData }) {
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
    const first = data.classDestinations[0];
    return first ? destinationValue(first) : "";
  });
  const [selectedTermId, setSelectedTermId] = useState(data.classTerm?.id ?? "");

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
    destination !== "" &&
    (isPeriod || (mode === "custom" && customDays.length > 0 && customStart !== "" && customEnd !== ""));

  const periodOptions = [
    { value: "", label: "Choose a class period…" },
    ...DARTMOUTH_PERIODS.map((p) => ({ value: p.code, label: periodSummary(p) })),
    { value: "custom", label: "Custom day & time…" },
  ];

  return (
    <>
        {!data.classTerm ? (
          <p className="text-sm text-muted-foreground">There's no active term to add classes to yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Existing classes — filtered to the selected term */}
            {data.memberClasses.filter((c) => c.termId === selectedTermId).length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {data.memberClasses.filter((c) => c.termId === selectedTermId).map((c) => (
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
            <fetcher.Form method="post" className="flex flex-col gap-3 rounded-lg p-3">
              <input type="hidden" name="intent" value={editingId ? "class-update" : "class-add"} />
              {editingId && <input type="hidden" name="classId" value={editingId} />}
              <input type="hidden" name="periodCode" value={isPeriod ? mode : ""} />
              <input type="hidden" name="includeXHour" value={isPeriod && includeXHour && period?.xhour ? "1" : ""} />
              <input type="hidden" name="customDays" value={mode === "custom" ? customDays.join(",") : ""} />
              <input type="hidden" name="customStart" value={customStart} />
              <input type="hidden" name="customEnd" value={customEnd} />
              <input type="hidden" name="destination" value={destination} />
              <input type="hidden" name="termId" value={selectedTermId} />

              {data.classTerms.length > 1 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Term</span>
                  <Select
                    value={selectedTermId}
                    onChange={setSelectedTermId}
                    options={data.classTerms.map((t) => ({ value: t.id, label: t.code }))}
                    placeholder="Choose a term…"
                    buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                  />
                </label>
              )}

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
                    <TimeComboField value={customStart} onChange={setCustomStart} ariaLabel="Class start time" className="min-w-0 flex-1" />
                    <span className="text-muted-foreground">to</span>
                    <TimeComboField value={customEnd} onChange={setCustomEnd} ariaLabel="Class end time" className="min-w-0 flex-1" />
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

              {data.classDestinations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Connect a Google calendar you can write to to add classes.
                </p>
              ) : (
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
              )}

              {fetcher.data?.error && <p className="text-xs text-red-600">{fetcher.data.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit || submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-os-accent-hover disabled:opacity-50"
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
    </>
  );
}

export function ClassesManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 backdrop-blur-sm p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close classes" onClick={onClose} tabIndex={-1} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Classes this term"
        className="relative z-10 w-full max-w-lg rounded-xl cal-surface p-5"
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
        <ClassesManagerBody data={data} />
      </div>
    </div>
  );
}
