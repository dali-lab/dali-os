// Dartmouth's official class "time sequence" (period) schedule, transcribed
// verbatim from the ORC:
//   https://dartmouth.smartcatalogiq.com/en/current/orc/instruction/time-sequence/
//
// Picking a period gives a class its exact weekly meeting times (and x-hour)
// without any external lookup — this is the accurate-times backbone of the
// "Classes this term" feature. Times are Dartmouth (US/Eastern) wall-clock,
// stored as minutes-from-local-midnight. Weekdays use the JS getDay()
// convention (Sun=0 … Sat=6) so they line up with the calendar grid and are
// trivially mapped to RRULE BYDAY codes.

export type ClassMeetingKind = "main" | "xhour";

/** One recurring weekly meeting pattern (the main block, or its x-hour). */
export type PeriodMeeting = {
  kind: ClassMeetingKind;
  /** getDay() weekday numbers this pattern meets on. */
  days: number[];
  /** Minutes from local midnight. */
  startMin: number;
  endMin: number;
};

export type DartmouthPeriod = {
  code: string;
  /** Group heading for the picker (meeting cadence). */
  group: string;
  main: PeriodMeeting;
  /** Every standard period has an x-hour; null only for future custom rows. */
  xhour: PeriodMeeting | null;
};

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const t = (h: number, m: number) => h * 60 + m;

const period = (
  code: string,
  group: string,
  mainDays: number[],
  main: [number, number, number, number],
  xDays: number[],
  x: [number, number, number, number],
): DartmouthPeriod => ({
  code,
  group,
  main: { kind: "main", days: mainDays, startMin: t(main[0], main[1]), endMin: t(main[2], main[3]) },
  xhour: { kind: "xhour", days: xDays, startMin: t(x[0], x[1]), endMin: t(x[2], x[3]) },
});

const G65 = "65-minute · three times weekly";
const G50 = "50-minute · four times weekly";
const G110 = "110-minute · twice weekly";
const G180 = "180-minute · once weekly";

// [code, group, mainDays, [startH,startM,endH,endM], xDays, [startH,startM,endH,endM]]
export const DARTMOUTH_PERIODS: DartmouthPeriod[] = [
  // 65-minute periods (MWF), x-hour on Tu/Th.
  period("8L", G65, [MON, WED, FRI], [7, 30, 8, 35], [THU], [7, 45, 8, 35]),
  period("9L", G65, [MON, WED, FRI], [8, 50, 9, 55], [THU], [9, 5, 9, 55]),
  period("10", G65, [MON, WED, FRI], [10, 10, 11, 15], [THU], [12, 15, 13, 5]),
  period("11", G65, [MON, WED, FRI], [11, 30, 12, 35], [TUE], [12, 15, 13, 5]),
  period("12", G65, [MON, WED, FRI], [12, 50, 13, 55], [TUE], [13, 20, 14, 10]),
  period("2", G65, [MON, WED, FRI], [14, 10, 15, 15], [THU], [13, 20, 14, 10]),
  // 50-minute periods (MTuThF), x-hour on Wed.
  period("8S", G50, [MON, TUE, THU, FRI], [7, 45, 8, 35], [WED], [7, 45, 8, 35]),
  period("9S", G50, [MON, TUE, THU, FRI], [9, 5, 9, 55], [WED], [9, 5, 9, 55]),
  // 110-minute periods (twice weekly).
  period("10A", G110, [TUE, THU], [10, 10, 12, 0], [FRI], [15, 30, 16, 20]),
  period("2A", G110, [TUE, THU], [14, 25, 16, 15], [WED], [17, 30, 18, 20]),
  period("3A", G110, [MON, WED], [15, 30, 17, 20], [MON], [17, 30, 18, 20]),
  period("3B", G110, [TUE, THU], [16, 30, 18, 20], [FRI], [16, 35, 17, 25]),
  period("6A", G110, [MON, THU], [18, 30, 20, 20], [TUE], [18, 30, 19, 20]),
  // 180-minute period (once weekly).
  period("6B", G180, [WED], [18, 30, 21, 30], [TUE], [19, 30, 20, 20]),
];

const BY_CODE = new Map(DARTMOUTH_PERIODS.map((p) => [p.code, p]));

export function getPeriod(code: string): DartmouthPeriod | undefined {
  return BY_CODE.get(code);
}

/** The concrete meetings a class occupies: the main block, plus the x-hour when
 *  the member opted in. Returns [] for an unknown code. Custom (non-period)
 *  classes carry their own PeriodMeeting[] and don't call this. */
export function periodMeetings(code: string, includeXHour: boolean): PeriodMeeting[] {
  const p = BY_CODE.get(code);
  if (!p) return [];
  const out: PeriodMeeting[] = [{ ...p.main }];
  if (includeXHour && p.xhour) out.push({ ...p.xhour });
  return out;
}

const DAY_ABBR = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
const RRULE_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** "M/W/F" style label for a set of getDay() weekdays, in week order. */
export function weekdayLabel(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_ABBR[d]).join("");
}

/** getDay() weekdays → RRULE BYDAY value ("MO,WE,FR"). */
export function rruleByDay(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => RRULE_DAY[d]).join(",");
}

/** Minutes-from-midnight → "10:10 AM" for labels. */
export function formatMinuteOfDay(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** One-line summary for a period picker option, e.g.
 *  "10 · MWF 10:10 AM–11:15 AM (x-hr Th)". */
export function periodSummary(p: DartmouthPeriod): string {
  const days = weekdayLabel(p.main.days);
  const time = `${formatMinuteOfDay(p.main.startMin)}–${formatMinuteOfDay(p.main.endMin)}`;
  const x = p.xhour ? ` (x-hr ${weekdayLabel(p.xhour.days)})` : "";
  return `${p.code} · ${days} ${time}${x}`;
}
