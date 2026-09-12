import type { Route } from "./+types/api.timesheets.export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { getZonedParts, resolveUserTimeZone, zonedDayStartUtc } from "~/lib/timezone";
import { getRoleLabel, getUserRoleInstances } from "~/lib/roles";
import { formatPayPeriod, payPeriodFor, PAY_PERIOD_DAYS } from "~/lib/pay-period";
import { timeEntryDayUtc } from "~/calendar/lib/timesheet-day";

// Export the caller's Timesheet-tab entries for the JobX browser extension
// (jobx-extension/), one hire and one pay period at a time — JobX timesheets
// are per-job and per-period, so that's the unit the extension fills.
//
// A "hire" is the concrete paid role a TimeEntry is attributed to, keyed by
// roleRefId (see app/lib/roles.ts#getUserRoleInstances), plus a catch-all
// "unassigned" bucket for legacy/unattributed entries. Pay periods are the
// computed fortnights from app/lib/pay-period.ts, not PayPeriod rows — those
// only exist once payroll has closed a period, and the member is filling one
// that's still open.
//
//   ?hire=<roleRefId | "unassigned">  which role; default: one with hours
//   ?period=<YYYY-MM-DD>              any day inside the period; default:
//                                     the role's most recent period with hours
//
// Entry times are wall-clock in the member's timesheet zone, because that's
// what JobX's hour/minute/AM-PM selects take.
const UNASSIGNED_KEY = "unassigned";
const LOOKBACK_PERIODS = 26;
const DAY_MS = 86_400_000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");

function parsePeriodParam(raw: string | null) {
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const day = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return isNaN(day.getTime()) ? null : payPeriodFor(day);
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const hireKeyParam = url.searchParams.get("hire");
  const requestedPeriod = parsePeriodParam(url.searchParams.get("period"));

  const now = new Date();
  // Windowed off the UTC day (the member's zone isn't loaded yet); a day of
  // slack absorbs the offset and date-only rows stored at UTC midnight.
  const windowStart = new Date(
    payPeriodFor(new Date(new Date(now).setUTCHours(0, 0, 0, 0))).start.getTime() -
      (LOOKBACK_PERIODS * PAY_PERIOD_DAYS + 1) * DAY_MS,
  );

  const [entries, userRow] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: windowStart } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 2000,
      select: {
        date: true,
        hours: true,
        note: true,
        startTime: true,
        endTime: true,
        assignmentType: true,
        roleRefId: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);

  // Pay periods bucket by day in the user's display zone (User.timeZone).
  const timezone = resolveUserTimeZone(userRow);
  const currentPeriod = payPeriodFor(
    timeEntryDayUtc({ date: now.toISOString(), startTime: now.toISOString() }, timezone),
  );

  const byKey = new Map<string, { label: string; entries: typeof entries }>();
  for (const e of entries) {
    const key = e.roleRefId ?? UNASSIGNED_KEY;
    let bucket = byKey.get(key);
    if (!bucket) {
      const label =
        e.assignmentType && e.roleRefId
          ? ((await getRoleLabel(e.assignmentType, e.roleRefId)) ?? "DALI Hours")
          : "DALI Hours";
      bucket = { label, entries: [] };
      byKey.set(key, bucket);
    }
    bucket.entries.push(e);
  }
  // Every paid role the member holds this term, not just the ones with hours
  // logged — a new hire needs to see their role before they've logged against it.
  for (const role of await getUserRoleInstances(userId, undefined, request)) {
    if (!byKey.has(role.roleRefId)) byKey.set(role.roleRefId, { label: role.label, entries: [] });
  }
  const availableHires = Array.from(byKey.entries()).map(([key, v]) => ({ key, label: v.label }));

  // Default to a bucket that actually has hours — landing on an empty role
  // just because it sorts first would look like the pull had failed.
  const firstWithEntries = availableHires.find((h) => byKey.get(h.key)!.entries.length > 0);
  const hireKey =
    hireKeyParam && byKey.has(hireKeyParam)
      ? hireKeyParam
      : (firstWithEntries?.key ?? availableHires[0]?.key ?? null);
  const hire = hireKey ? byKey.get(hireKey)! : null;

  const periods = new Map<
    number,
    { period: ReturnType<typeof payPeriodFor>; entries: typeof entries; hours: number }
  >();
  const periodOf = (period: ReturnType<typeof payPeriodFor>) => {
    let p = periods.get(period.index);
    if (!p) {
      p = { period, entries: [], hours: 0 };
      periods.set(period.index, p);
    }
    return p;
  };
  for (const e of hire?.entries ?? []) {
    const day = timeEntryDayUtc(
      { date: e.date.toISOString(), startTime: e.startTime?.toISOString() },
      timezone,
    );
    const p = periodOf(payPeriodFor(day));
    p.entries.push(e);
    p.hours += e.hours;
  }
  // A period the extension asked for by date stays listed even with no hours,
  // so the picker can show the JobX page's own period as empty rather than
  // silently landing on a different one.
  if (requestedPeriod) periodOf(requestedPeriod);

  const sorted = Array.from(periods.values()).sort((a, b) => b.period.index - a.period.index);
  const selected = requestedPeriod
    ? periods.get(requestedPeriod.index)!
    : sorted.find((p) => p.entries.length > 0);

  const wallClock = (d: Date) => {
    const z = getZonedParts(d, timezone);
    return { date: `${z.year}-${pad2(z.month)}-${pad2(z.day)}`, time: `${pad2(z.hour)}:${pad2(z.minute)}` };
  };

  const payload = {
    timezone,
    hireKey,
    hireLabel: hire?.label ?? null,
    availableHires,
    periodKey: selected ? ymd(selected.period.start) : null,
    periods: sorted.map((p) => ({
      key: ymd(p.period.start),
      start: ymd(p.period.start),
      end: ymd(p.period.end),
      label: formatPayPeriod(p.period, timezone),
      hours: Math.round(p.hours * 100) / 100,
      entryCount: p.entries.length,
      current: p.period.index === currentPeriod.index,
    })),
    entries: (selected?.entries ?? []).map((e) => {
      // Entries added via the plain date+hours quick-add always get a real
      // startTime/endTime now (see nominalDayRange in calendar.tsx), but
      // older/legacy rows or attendance on a still-unscheduled meeting may
      // not — fall back to a nominal 9am slot so every entry still exports.
      const start = e.startTime ?? (() => {
        const dayStart = zonedDayStartUtc(
          e.date.getUTCFullYear(),
          e.date.getUTCMonth() + 1,
          e.date.getUTCDate(),
          timezone,
        );
        return new Date(dayStart.getTime() + 9 * 3_600_000);
      })();
      const end = e.endTime ?? new Date(start.getTime() + Math.max(e.hours, 0.25) * 3_600_000);
      const s = wallClock(start);
      return {
        date: s.date,
        start: s.time,
        end: wallClock(end).time,
        hours: e.hours,
        description: e.note ?? "",
      };
    }),
  };

  return withCors(request, Response.json(payload));
}
