import { DateField } from "~/components/ui/DateField";
import { Select, InfoTip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

// The calendar's one recurrence control — used by Create Meeting and by both
// manual-block popovers. It edits a small structured spec rather than an RRULE
// string so no surface has to hand-roll (or show) RFC 5545; `repeatSpecToRRule`
// is the single place the string is built.
//
// Every consumer stores the result on a row whose occurrences are expanded by
// the `rrule` package (app/lib/meeting-occurrences.ts, app/lib/availability.ts)
// and forwarded verbatim to Google Calendar / ICS, all of which understand
// INTERVAL, BYDAY, COUNT and UNTIL.
//
// Layout: the detail is an inset panel subordinate to the Repeats choice above
// it, laid out on a fixed label rail so every control starts on the same x
// instead of ragging against the left edge. The weekday strip is a 7-column
// grid and the Ends switch is a segmented group — both borrowed from DateField
// (its calendar grid and its AM/PM toggle), so the two controls read as one
// family when they sit side by side in a form.

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly" | "yearly";

// Monthly recurrence, matching Google's two custom-monthly choices: repeat on
// the same day-of-month as the start ("on day 14") vs. the same weekday-of-month
// ("on the second Tuesday"). The latter needs the series anchor to resolve.
export type MonthlyMode = "onDay" | "onWeekday";

export type RepeatEnd =
  | { type: "never" }
  | { type: "on"; date: string } // "YYYY-MM-DD", the last day it may occur
  | { type: "after"; count: number };

export type RepeatSpec = {
  freq: RepeatFreq;
  interval: number;
  /** Weekly only. 0=Sun … 6=Sat. Empty => whatever weekday the series starts on. */
  byDay: number[];
  /** Monthly only. Defaults to "onDay" (same day-of-month as the start). */
  monthlyMode?: MonthlyMode;
  end: RepeatEnd;
};

export const NO_REPEAT: RepeatSpec = {
  freq: "none",
  interval: 1,
  byDay: [],
  monthlyMode: "onDay",
  end: { type: "never" },
};

// A repeat that ends by count is capped here — high enough to cover a full year
// of weekly meetings (Google's own limit is far higher, but this keeps the
// RRULE well under the 500-char server bound and the picker sane).
export const MAX_REPEAT_COUNT = 100;

const FREQ_OPTIONS: { value: RepeatFreq; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const END_SEGMENTS: { value: RepeatEnd["type"]; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "on", label: "On date" },
  { value: "after", label: "After" },
];

const UNIT_LABEL: Record<Exclude<RepeatFreq, "none">, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

const ORDINAL_LABEL: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
// Two letters so Tuesday and Thursday (and Saturday/Sunday) stay distinguishable.
const DAY_CHIPS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// The label rail. `leading-8` centres each label against the 32px control in
// its row without needing per-row alignment.
const RAIL_LABEL = "text-xs font-medium text-muted-foreground leading-8";
const PANEL_INPUT =
  "h-8 w-14 rounded-md border border-border bg-background px-2 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-os-accent/40";
const HINT = "text-xs text-muted-foreground";

const clampInt = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;

/** The weekday (0=Sun) of a "YYYY-MM-DD…" local wall-clock string. */
export function weekdayOf(localValue: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(localValue ?? "");
  if (!m) return null;
  // UTC-pinned: this is calendar math on a literal date, not an instant.
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
}

/**
 * Which occurrence of its weekday the date is within its month, 1-based; a 5th
 * occurrence collapses to -1 ("last"), matching Google — every month has a 1st
 * through 4th of any weekday, but not always a 5th.
 */
export function weekdayOrdinalOf(localValue: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(localValue ?? "");
  if (!m) return null;
  const ord = Math.ceil(+m[3]! / 7);
  return ord >= 5 ? -1 : ord;
}

// UNTIL is an instant, so an end DATE means "through the end of that local day".
function untilStamp(date: string): string | null {
  const end = new Date(`${date}T23:59:59`);
  if (isNaN(end.getTime())) return null;
  return `${end.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * Build the RRULE for a spec, or null when it doesn't repeat. `anchorLocal`
 * (the series start, "YYYY-MM-DD…") is only needed for monthly-by-weekday,
 * where the weekday and its ordinal come from the start date.
 */
export function repeatSpecToRRule(spec: RepeatSpec, anchorLocal?: string): string | null {
  if (spec.freq === "none") return null;
  const parts = [`FREQ=${spec.freq.toUpperCase()}`];
  const interval = clampInt(spec.interval, 1, 52);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (spec.freq === "weekly" && spec.byDay.length > 0) {
    const days = [...new Set(spec.byDay)].sort((a, b) => a - b);
    parts.push(`BYDAY=${days.map((d) => RRULE_DAYS[d]).join(",")}`);
  }
  if (spec.freq === "monthly" && spec.monthlyMode === "onWeekday") {
    const wd = weekdayOf(anchorLocal);
    const ord = weekdayOrdinalOf(anchorLocal);
    // No anchor → fall back to plain FREQ=MONTHLY (same day-of-month).
    if (wd !== null && ord !== null) parts.push(`BYDAY=${ord}${RRULE_DAYS[wd]}`);
  }
  if (spec.end.type === "after") {
    parts.push(`COUNT=${clampInt(spec.end.count, 1, MAX_REPEAT_COUNT)}`);
  } else if (spec.end.type === "on") {
    const until = untilStamp(spec.end.date);
    if (until) parts.push(`UNTIL=${until}`);
  }
  return parts.join(";");
}

export function RepeatField({
  value,
  onChange,
  anchorLocal,
  labelClassName,
  fieldClassName,
}: {
  value: RepeatSpec;
  onChange: (next: RepeatSpec) => void;
  /**
   * The series' start ("YYYY-MM-DD" or "YYYY-MM-DDThh:mm"), used to preselect
   * the weekday when Weekly is chosen and to floor the "On date" picker.
   */
  anchorLocal?: string;
  labelClassName: string;
  fieldClassName: string;
}) {
  const [singular, plural] = value.freq === "none" ? ["", ""] : UNIT_LABEL[value.freq];
  const anchorDay = weekdayOf(anchorLocal);
  const anchorDate = anchorLocal?.slice(0, 10);
  const anchorDayNum = anchorDate ? Number(anchorDate.slice(8, 10)) : null;
  const anchorOrdinal = weekdayOrdinalOf(anchorLocal);
  const monthlyMode: MonthlyMode = value.monthlyMode ?? "onDay";
  const monthlyOptions: { value: MonthlyMode; label: string }[] = [
    { value: "onDay", label: anchorDayNum ? `Monthly on day ${anchorDayNum}` : "On the same date" },
    {
      value: "onWeekday",
      label:
        anchorDay !== null && anchorOrdinal !== null
          ? `On the ${ORDINAL_LABEL[anchorOrdinal]} ${DAY_NAMES[anchorDay]}`
          : "On the same weekday",
    },
  ];

  function pickFreq(freq: RepeatFreq) {
    // Weekly with no days chosen would silently fall back to the start's
    // weekday, so seed it visibly instead.
    const byDay =
      freq === "weekly" && value.byDay.length === 0 && anchorDay !== null
        ? [anchorDay]
        : value.byDay;
    onChange({ ...value, freq, byDay });
  }

  function toggleDay(day: number) {
    onChange({
      ...value,
      byDay: value.byDay.includes(day)
        ? value.byDay.filter((d) => d !== day)
        : [...value.byDay, day],
    });
  }

  function pickEnd(type: RepeatEnd["type"]) {
    if (type === "never") return onChange({ ...value, end: { type: "never" } });
    if (type === "after") return onChange({ ...value, end: { type: "after", count: 5 } });
    onChange({ ...value, end: { type: "on", date: value.end.type === "on" ? value.end.date : "" } });
  }

  return (
    <div>
      <span className={cn(labelClassName, "inline-flex items-center gap-1")}>
        Repeats
        <InfoTip content="Creates a recurring series using your chosen frequency. The invitation goes to all participants for each occurrence. Recurring blocks cannot be marked as work time." />
      </span>
      <Select
        value={value.freq}
        onChange={(v) => pickFreq(v as RepeatFreq)}
        options={FREQ_OPTIONS}
        ariaLabel="Repeats"
        buttonClassName={cn(
          fieldClassName,
          "inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40",
        )}
      />

      {value.freq !== "none" && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-3">
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-2">
            <span className={RAIL_LABEL}>Every</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={52}
                value={value.interval}
                aria-label={`Repeat every N ${plural}`}
                onChange={(e) =>
                  onChange({ ...value, interval: clampInt(e.target.valueAsNumber, 1, 52) })
                }
                className={PANEL_INPUT}
              />
              <span className={cn(HINT, "leading-8")}>
                {value.interval === 1 ? singular : plural}
              </span>
            </div>

            {value.freq === "weekly" && (
              <>
                <span className={RAIL_LABEL}>On</span>
                <div className="flex flex-col gap-1.5 py-1">
                  {/* Seven equal cells rather than a left-hugging row — the same
                      shape (and coral selection) as DateField's calendar grid. */}
                  <div className="grid grid-cols-7 gap-1">
                    {DAY_CHIPS.map((chip, day) => {
                      const on = value.byDay.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          aria-label={DAY_NAMES[day]}
                          onClick={() => toggleDay(day)}
                          className={cn(
                            "flex aspect-square min-w-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                            on
                              ? "bg-os-accent text-os-bg"
                              : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>
                  {value.byDay.length === 0 && (
                    <p className={HINT}>Repeats on whatever day it starts.</p>
                  )}
                </div>
              </>
            )}

            {value.freq === "monthly" && (
              <>
                <span className={RAIL_LABEL}>On</span>
                <Select
                  value={monthlyMode}
                  onChange={(v) => onChange({ ...value, monthlyMode: v as MonthlyMode })}
                  options={monthlyOptions}
                  ariaLabel="Which day each month it repeats"
                  buttonClassName="inline-flex h-8 w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-2 text-sm text-foreground transition-colors hover:bg-muted/40"
                />
              </>
            )}

            <span className={RAIL_LABEL}>Ends</span>
            <div className="flex flex-col gap-2">
              <Select
                value={value.end.type}
                onChange={(v) => pickEnd(v as RepeatEnd["type"])}
                options={END_SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
                ariaLabel="When the repeat ends"
                buttonClassName="inline-flex h-8 w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-2 text-sm text-foreground transition-colors hover:bg-muted/40"
              />

              {value.end.type === "on" && (
                <DateField
                  mode="date"
                  value={value.end.date}
                  min={anchorDate || undefined}
                  onChange={(date) => onChange({ ...value, end: { type: "on", date } })}
                  className="w-full"
                  ariaLabel="Repeat end date"
                />
              )}
              {value.end.type === "after" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={MAX_REPEAT_COUNT}
                    value={value.end.count}
                    aria-label="Number of occurrences"
                    onChange={(e) =>
                      onChange({
                        ...value,
                        end: {
                          type: "after",
                          count: clampInt(e.target.valueAsNumber, 1, MAX_REPEAT_COUNT),
                        },
                      })
                    }
                    className={PANEL_INPUT}
                  />
                  <span className={cn(HINT, "leading-8")}>
                    times · max {MAX_REPEAT_COUNT}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
