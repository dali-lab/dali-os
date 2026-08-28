import { useFetcher, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { RoleInstance } from "~/lib/roles";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import { formatPayPeriod, payPeriodFor } from "~/lib/pay-period";
import { timeEntryDayUtc } from "~/calendar/lib/timesheet-day";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import { Tooltip } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
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
/* Drag-to-create side modal (My Availability tab)                      */
/* ------------------------------------------------------------------ */

export function CreateFromDragPopover({
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

export function TimesheetView({ data }: { data: LoaderData }) {
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
