import { useFetcher, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import type { RoleInstance } from "~/lib/roles";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import { PAY_PERIOD_DAYS, formatPayPeriod, payPeriodFor } from "~/lib/pay-period";
import { timeEntryDayUtc } from "~/calendar/lib/timesheet-day";
import { Tooltip } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { TimeEntryDTO, LoaderData, EventBlock } from "~/calendar/lib/types";
import {
  UNASSIGNED_ROLE_KEY, roleColor, timeEntryRoleKey,
  nominalDayRange, localDayTimeToIso, todayDateInputValue, dayHourToLocal,
} from "~/calendar/lib/event-block";
import {
  WeekGrid, useRefreshOnFocus,
} from "~/calendar/components/WeekGrid";
import { timeEntryRange } from "~/calendar/lib/layers";
import { CustomHiresManager } from "~/calendar/components/CustomHiresManager";
import { FIELD_BASE, roleOptionKey, parseRoleOptionKey, RoleSelectField, RoleFilterRow } from "~/calendar/components/role-fields";
import { WeekToolbar } from "~/calendar/components/scheduling";

// Shown wherever time can be logged but the user holds no paid role. Every
// entry must attribute to one, so there's nothing valid to submit.
const NO_ROLES_MESSAGE =
  "You have no paid roles this term, so there's nothing to log hours against.";

export function TimesheetSummaryRail({
  roleBuckets,
  periodLabel,
}: {
  roleBuckets: { key: string; label: string; hours: number }[];
  periodLabel: string;
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
    </div>
  );
}

export function TimesheetView({ data }: { data: LoaderData }) {
  const { compactField } = useOsChrome();
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-4">
      {/* No card and no heading around the add row — the rail's own rounded
          border is the only frame it needs, and the tab already says where
          you are. Adding an outside job is how someone with no current DALI
          assignment gets a role to log against, so it stays reachable even
          when the form below shows the no-roles message. */}
      <div className="flex justify-end">
        <CustomHiresManager
          hires={data.myRoles
            .filter((r) => r.assignmentType === "Custom")
            .map((r) => ({ id: r.roleRefId, label: r.label }))}
        />
      </div>
      <div>
        {!hasRoles ? (
          <p className="text-xs text-red-600">{NO_ROLES_MESSAGE}</p>
        ) : (
          <>
            {/* One rounded rail of borderless fields — placeholders carry the
                meaning, so the row reads as a single control rather than five
                labelled boxes. */}
            <addFetcher.Form
              method="post"
              onSubmit={(e) => {
                if (!canSubmit) {
                  e.preventDefault();
                  return;
                }
                queueMicrotask(() => resetAddForm());
              }}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-border p-2"
            >
              <input type="hidden" name="intent" value="add-time-entry" />
              {/* Hours is derived from the range, never typed — the server
                  re-derives and rejects any mismatch. */}
              <input type="hidden" name="hours" value={hours > 0 ? String(hours) : ""} />
              <input type="hidden" name="startTime" value={startIso ?? ""} />
              <input type="hidden" name="endTime" value={endIso ?? ""} />

              <DateField
                mode="date"
                name="date"
                required
                value={date}
                onChange={setDate}
                ariaLabel="Date"
                className="w-[10rem]"
              />
              <DateField
                mode="time"
                required
                value={startTime}
                onChange={setStartTime}
                ariaLabel="Start time"
                className="w-[8rem]"
              />
              <DateField
                mode="time"
                required
                value={endTime}
                onChange={setEndTime}
                ariaLabel="End time"
                className="w-[8rem]"
              />
              <Select
                value={roleKey}
                onChange={setRoleKey}
                options={[
                  { value: "", label: "Role" },
                  ...data.myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label })),
                ]}
                buttonClassName={cn(FIELD_BASE, compactField, "w-[10rem] justify-between border-border")}
              />
              <input
                type="text"
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Heads-down: Deserto bug fixes"
                className={cn(FIELD_BASE, compactField, "min-w-[12rem] flex-1 border-border")}
              />
              <button
                type="submit"
                disabled={!canSubmit}
                className="ml-auto shrink-0 rounded-full bg-os-accent px-5 py-2 text-sm font-semibold text-os-bg transition-colors hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add entry
              </button>
            </addFetcher.Form>

            {(rangeError || serverError) && (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {serverError ?? rangeError}
              </p>
            )}
          </>
        )}
      </div>

      <TimesheetEntries data={data} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pay-period entry list. The navigator steps by pay period (biweekly)  */
/* rather than by week, and the total is the period's, because that is  */
/* the unit hours are actually submitted and paid in.                   */
/* ------------------------------------------------------------------ */

function TimesheetEntries({ data }: { data: LoaderData }) {
  const [offset, setOffset] = useState(0);
  const [roleFilter, setRoleFilter] = useState("");

  const basePeriod = payPeriodFor(new Date(data.weekStartIso));
  const period = payPeriodFor(
    new Date(basePeriod.start.getTime() + offset * PAY_PERIOD_DAYS * 86_400_000),
  );

  const inPeriod = data.timeEntries.filter((t) => {
    const day = timeEntryDayUtc(t, data.timezone).getTime();
    return day >= period.start.getTime() && day <= period.end.getTime();
  });
  const rows = (roleFilter ? inPeriod.filter((t) => timeEntryRoleKey(t) === roleFilter) : inPeriod)
    .slice()
    .sort((a, b) => {
      const byDay =
        timeEntryDayUtc(a, data.timezone).getTime() - timeEntryDayUtc(b, data.timezone).getTime();
      return byDay !== 0 ? byDay : (a.startTime ?? "").localeCompare(b.startTime ?? "");
    });
  const total = rows.reduce((sum, t) => sum + t.hours, 0);

  const navBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={navBtn} onClick={() => setOffset((o) => o - 1)} aria-label="Previous pay period">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOffset(0)}
          className="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Today
        </button>
        <button type="button" className={navBtn} onClick={() => setOffset((o) => o + 1)} aria-label="Next pay period">
          <ChevronRight className="h-4 w-4" />
        </button>
        <h2 className="font-heading text-lg font-medium text-foreground">
          Pay period {formatPayPeriod(period, data.timezone)}
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: "", label: "All roles" },
              ...data.myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label })),
            ]}
            buttonClassName="inline-flex items-center justify-between gap-1 rounded-full border border-border px-4 py-1.5 text-sm text-foreground hover:bg-muted"
          />
          <span className="rounded-full border border-border px-4 py-1.5 text-sm font-bold text-os-accent">
            {total.toFixed(1)} hrs logged
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-bold">Date</th>
              <th className="px-3 py-2 font-bold">Description</th>
              <th className="px-3 py-2 font-bold">Time</th>
              <th className="px-3 py-2 font-bold">Duration</th>
              <th className="px-3 py-2 font-bold">Role</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nothing logged this pay period yet.
                </td>
              </tr>
            ) : (
              rows.map((t) => <EntryRow key={t.id} entry={t} data={data} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One editable row. Every field writes through `update-time-entry` when it
 *  commits — blur for the text, change for the pickers — so there is no
 *  separate edit mode to enter and leave. */
function EntryRow({ entry, data }: { entry: TimeEntryDTO; data: LoaderData }) {
  const revalidator = useRevalidator();
  const removeFetcher = useFetcher();
  const { startIso, endIso } = timeEntryRange(entry, data.timezone);

  const [date, setDate] = useState(startIso.slice(0, 10));
  const [start, setStart] = useState(hhmm(startIso, data.timezone));
  const [end, setEnd] = useState(hhmm(endIso, data.timezone));
  const [note, setNote] = useState(entry.note ?? "");
  const [roleKey, setRoleKey] = useState(timeEntryRoleKey(entry));
  const [saving, setSaving] = useState(false);

  // Re-seed when the loader brings this entry back changed.
  useEffect(() => {
    setDate(startIso.slice(0, 10));
    setStart(hhmm(startIso, data.timezone));
    setEnd(hhmm(endIso, data.timezone));
    setNote(entry.note ?? "");
    setRoleKey(timeEntryRoleKey(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, startIso, endIso, entry.note]);

  const hoursFor = (d: string, s: string, e: string) => {
    const a = d && s ? localDayTimeToIso(d, s, data.timezone) : null;
    const b = d && e ? localDayTimeToIso(d, e, data.timezone) : null;
    if (!a || !b) return { a, b, hours: 0 };
    return {
      a,
      b,
      hours: Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 3_600_000) * 100) / 100,
    };
  };
  const { hours } = hoursFor(date, start, end);

  async function commit(next: Partial<{ date: string; start: string; end: string; note: string; roleKey: string }> = {}) {
    const d = next.date ?? date;
    const s = next.start ?? start;
    const e = next.end ?? end;
    const n = next.note ?? note;
    const key = next.roleKey ?? roleKey;
    const { a, b, hours: h } = hoursFor(d, s, e);
    if (!a || !b || h <= 0 || h > 24 || !key) return;
    setSaving(true);
    try {
      const role = parseRoleOptionKey(key);
      const body = new FormData();
      body.set("intent", "update-time-entry");
      body.set("id", entry.id);
      body.set("startTime", a);
      body.set("endTime", b);
      body.set("date", d);
      body.set("hours", String(h));
      body.set("assignmentType", role?.assignmentType ?? "");
      body.set("roleRefId", role?.roleRefId ?? "");
      body.set("note", n.trim());
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (res.ok) revalidator.revalidate();
    } finally {
      setSaving(false);
    }
  }

  const cellInput =
    "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground hover:border-border focus:border-os-accent focus:bg-background focus:outline-none";

  return (
    <tr className={cn("border-t border-border", saving && "opacity-60")}>
      <td className="px-3 py-1.5 align-middle">
        <DateField
          mode="date"
          value={date}
          onChange={(v) => {
            setDate(v);
            void commit({ date: v });
          }}
          ariaLabel="Date"
          className="w-[9rem]"
        />
      </td>
      <td className="px-3 py-1.5 align-middle">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => commit()}
          placeholder="What did you work on?"
          className={cellInput}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 align-middle">
        <div className="flex items-center gap-1">
          <DateField
            mode="time"
            value={start}
            onChange={(v) => {
              setStart(v);
              void commit({ start: v });
            }}
            ariaLabel="Start"
            className="w-[6.5rem]"
          />
          <span className="text-muted-foreground">–</span>
          <DateField
            mode="time"
            value={end}
            onChange={(v) => {
              setEnd(v);
              void commit({ end: v });
            }}
            ariaLabel="End"
            className="w-[6.5rem]"
          />
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 align-middle font-medium text-foreground">
        {hours.toFixed(1)} hrs
      </td>
      <td className="px-3 py-1.5 align-middle">
        <Select
          value={roleKey}
          onChange={(v) => {
            setRoleKey(v);
            void commit({ roleKey: v });
          }}
          options={data.myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
          buttonClassName={cn(cellInput, "inline-flex items-center justify-between gap-1")}
        />
      </td>
      <td className="px-3 py-1.5 align-middle">
        <button
          type="button"
          aria-label="Delete entry"
          onClick={() =>
            removeFetcher.submit({ intent: "delete-time-entry", id: entry.id }, { method: "post" })
          }
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

/** "HH:mm" for a time input, in the viewer's timezone. */
function hhmm(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
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
  // Availability's grid still shows the full picture — that's the tab for "when am I busy".
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
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
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
      className="cal-surface w-80 max-h-[26rem] overflow-y-auto rounded-lg"
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
            className="px-4 py-2 rounded-md bg-os-accent text-os-bg text-sm font-medium hover:bg-os-accent/90 transition-colors disabled:opacity-50"
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
export function TimesheetEditPopover({
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
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
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
      className="cal-surface w-80 max-h-[26rem] overflow-y-auto rounded-lg"
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
              className="px-4 py-2 rounded-md bg-os-accent text-os-bg text-sm font-medium hover:bg-os-accent/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
