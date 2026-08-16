import { DateField } from "~/components/ui/DateField";
import { Select } from "~/components/ui/floating";

// The calendar's one recurrence control — used by Create Meeting and by both
// manual-block popovers. It edits a small structured spec rather than an RRULE
// string so no surface has to hand-roll (or show) RFC 5545; `repeatSpecToRRule`
// is the single place the string is built.
//
// Every consumer stores the result on a row whose occurrences are expanded by
// the `rrule` package (app/lib/meeting-occurrences.ts, app/lib/availability.ts)
// and forwarded verbatim to Google Calendar / ICS, all of which understand
// INTERVAL, BYDAY, COUNT and UNTIL.

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly";

export type RepeatEnd =
  | { type: "never" }
  | { type: "on"; date: string } // "YYYY-MM-DD", the last day it may occur
  | { type: "after"; count: number };

export type RepeatSpec = {
  freq: RepeatFreq;
  interval: number;
  /** Weekly only. 0=Sun … 6=Sat. Empty => whatever weekday the series starts on. */
  byDay: number[];
  end: RepeatEnd;
};

export const NO_REPEAT: RepeatSpec = {
  freq: "none",
  interval: 1,
  byDay: [],
  end: { type: "never" },
};

// A repeat that ends by count is capped here — the control is for a short
// series, not an open-ended one (use "Never" for that).
export const MAX_REPEAT_COUNT = 10;

const FREQ_OPTIONS: { value: RepeatFreq; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const END_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "on", label: "On date" },
  { value: "after", label: "After" },
] as const;

const UNIT_LABEL: Record<Exclude<RepeatFreq, "none">, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
// Two letters so Tuesday and Thursday (and Saturday/Sunday) stay distinguishable.
const DAY_CHIPS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

const clampInt = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;

/** The weekday (0=Sun) of a "YYYY-MM-DD…" local wall-clock string. */
export function weekdayOf(localValue: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(localValue ?? "");
  if (!m) return null;
  // UTC-pinned: this is calendar math on a literal date, not an instant.
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
}

// UNTIL is an instant, so an end DATE means "through the end of that local day".
function untilStamp(date: string): string | null {
  const end = new Date(`${date}T23:59:59`);
  if (isNaN(end.getTime())) return null;
  return `${end.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** Build the RRULE for a spec, or null when it doesn't repeat. */
export function repeatSpecToRRule(spec: RepeatSpec): string | null {
  if (spec.freq === "none") return null;
  const parts = [`FREQ=${spec.freq.toUpperCase()}`];
  const interval = clampInt(spec.interval, 1, 52);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (spec.freq === "weekly" && spec.byDay.length > 0) {
    const days = [...new Set(spec.byDay)].sort((a, b) => a - b);
    parts.push(`BYDAY=${days.map((d) => RRULE_DAYS[d]).join(",")}`);
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
  idPrefix,
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
  idPrefix: string;
}) {
  const repeating = value.freq !== "none";
  const [singular, plural] = value.freq === "none" ? ["", ""] : UNIT_LABEL[value.freq];
  const anchorDay = weekdayOf(anchorLocal);
  const anchorDate = anchorLocal?.slice(0, 10);

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
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor={`${idPrefix}-freq`} className={labelClassName}>
          Repeats
        </label>
        <Select
          value={value.freq}
          onChange={(v) => pickFreq(v as RepeatFreq)}
          options={FREQ_OPTIONS}
          ariaLabel="Repeats"
          buttonClassName={`${fieldClassName} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
        />
      </div>

      {repeating && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <input
              type="number"
              min={1}
              max={52}
              value={value.interval}
              aria-label={`Repeat every N ${plural}`}
              onChange={(e) =>
                onChange({ ...value, interval: clampInt(e.target.valueAsNumber, 1, 52) })
              }
              className="h-9 w-16 px-2 text-sm border border-border rounded-md bg-background text-foreground"
            />
            <span className="text-xs text-muted-foreground">
              {value.interval === 1 ? singular : plural}
            </span>
          </div>

          {value.freq === "weekly" && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Repeat on</span>
              <div className="flex flex-wrap gap-1">
                {DAY_CHIPS.map((chip, day) => {
                  const on = value.byDay.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(day)}
                      className={`h-8 min-w-8 px-2 text-xs font-semibold rounded-full border transition-colors ${
                        on
                          ? "bg-accent-coral border-accent-coral text-white"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
              {value.byDay.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No days picked — it repeats on whichever day the series starts.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Ends</span>
            <Select
              value={value.end.type}
              onChange={(v) => pickEnd(v as RepeatEnd["type"])}
              options={END_OPTIONS as unknown as { value: string; label: string }[]}
              ariaLabel="Repeat ends"
              buttonClassName="h-9 px-2 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
            {value.end.type === "on" && (
              <DateField
                mode="date"
                value={value.end.date}
                min={anchorDate || undefined}
                onChange={(date) => onChange({ ...value, end: { type: "on", date } })}
                className="w-44"
                ariaLabel="Repeat end date"
              />
            )}
            {value.end.type === "after" && (
              <>
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
                  className="h-9 w-16 px-2 text-sm border border-border rounded-md bg-background text-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  times (max {MAX_REPEAT_COUNT})
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
