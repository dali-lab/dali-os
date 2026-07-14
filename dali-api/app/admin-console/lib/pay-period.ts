// Pure pay-period helpers: parse the TimesheetX "MM/DD/YYYY - MM/DD/YYYY"
// period label into UTC-midnight dates, and match a period to a Term with no
// external (Dartmouth) API dependency. No Prisma imports — fully unit-testable.

// Accepts both " - " and " to " separators (the export has used both).
const PERIOD_RE =
  /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(?:-|to)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ParsedPayPeriod = {
  /** Canonical "MM/DD/YYYY - MM/DD/YYYY" label (zero-padded, " - " separator). */
  name: string;
  startDate: Date;
  endDate: Date;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function canonicalName(
  sm: number,
  sd: number,
  sy: number,
  em: number,
  ed: number,
  ey: number,
): string {
  return `${pad2(sm)}/${pad2(sd)}/${sy} - ${pad2(em)}/${pad2(ed)}/${ey}`;
}

/**
 * Parse a pay-period label into UTC-midnight start/end dates and a canonical
 * name. Validates the biweekly shape: Sunday start, Saturday end, and exactly
 * 13 days (start → end) difference = 14 calendar days inclusive.
 *
 * Returns null if the string doesn't match or fails validation — callers treat
 * null as "reject this period, report an error".
 */
export function parsePayPeriodName(raw: string): ParsedPayPeriod | null {
  const m = PERIOD_RE.exec(raw);
  if (!m) return null;

  const [, sMonth, sDay, sYear, eMonth, eDay, eYear] = m;
  const sm = Number(sMonth);
  const sd = Number(sDay);
  const sy = Number(sYear);
  const em = Number(eMonth);
  const ed = Number(eDay);
  const ey = Number(eYear);

  // Construct at UTC midnight so comparisons line up with Term.startDate/endDate
  // (also UTC midnight) and there's no local-timezone off-by-one.
  const startDate = new Date(Date.UTC(sy, sm - 1, sd));
  const endDate = new Date(Date.UTC(ey, em - 1, ed));

  // Guard against invalid calendar dates (e.g. 02/30) — Date.UTC rolls those
  // over, so re-derive and compare.
  if (
    startDate.getUTCMonth() !== sm - 1 ||
    startDate.getUTCDate() !== sd ||
    endDate.getUTCMonth() !== em - 1 ||
    endDate.getUTCDate() !== ed
  ) {
    return null;
  }

  // Sunday start (UTC day 0), Saturday end (UTC day 6).
  if (startDate.getUTCDay() !== 0 || endDate.getUTCDay() !== 6) return null;

  // 14 calendar days inclusive → 13 days between the two midnights.
  const dayDiff = (endDate.getTime() - startDate.getTime()) / MS_PER_DAY;
  if (dayDiff !== 13) return null;

  return {
    name: canonicalName(sm, sd, sy, em, ed, ey),
    startDate,
    endDate,
  };
}

/**
 * Canonicalize a period label to the "MM/DD/YYYY - MM/DD/YYYY" form used as the
 * PayPeriod.name unique key, without full validation. Returns null if the
 * string is unparseable. (parsePayPeriodName both validates and canonicalizes;
 * this is for the rare place that only needs the key.)
 */
export function canonicalizePayPeriodName(raw: string): string | null {
  const m = PERIOD_RE.exec(raw);
  if (!m) return null;
  const [, sMonth, sDay, sYear, eMonth, eDay, eYear] = m;
  return canonicalName(
    Number(sMonth),
    Number(sDay),
    Number(sYear),
    Number(eMonth),
    Number(eDay),
    Number(eYear),
  );
}

export type TermWindow = { id: string; startDate: Date; endDate: Date };

/**
 * Match a pay period to a Term with a deterministic, API-free rule:
 *   1. the Term whose [startDate, endDate] window contains the period's END
 *      date (a period is "in" the term it finishes in), else
 *   2. the nearest PRECEDING term (largest endDate ≤ the period's end), else
 *   3. null (leave termId unset; admin can override).
 *
 * The end date is used rather than the start so a period straddling a term
 * boundary attributes to the term it lands in.
 */
export function matchTermForPeriod(
  period: { endDate: Date },
  terms: TermWindow[],
): string | null {
  const end = period.endDate.getTime();

  const containing = terms.find(
    (t) => t.startDate.getTime() <= end && end <= t.endDate.getTime(),
  );
  if (containing) return containing.id;

  let best: TermWindow | null = null;
  for (const t of terms) {
    if (t.endDate.getTime() <= end) {
      if (best === null || t.endDate.getTime() > best.endDate.getTime()) {
        best = t;
      }
    }
  }
  return best?.id ?? null;
}
