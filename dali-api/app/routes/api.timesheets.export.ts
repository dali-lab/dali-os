import type { Route } from "./+types/api.timesheets.export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { APPLICATION_TZ, zonedDayStartUtc } from "~/lib/timezone";

// Export the caller's Timesheet-tab entries in the shape the JobX browser
// extension (jobx-extension/) consumes:
//   { hireLabel, entries: [{ startAt, endAt, description, projectLabel }] }
//
// JobX timesheets are per-job, so the extension fills one "hire" at a time.
// There's no separate job-code concept on TimeEntry — each Project a member
// has logged hours against stands in for a hire, plus a catch-all
// "unassigned" bucket for entries with no project. Pass ?hire=<projectId
// or "unassigned"> to pick which bucket to export; omit it to export the
// member's first available bucket. ?from / ?to (ISO dates) bound the
// window; default is the last 30 days, which comfortably covers a JobX pay
// period.
const UNASSIGNED_KEY = "unassigned";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const hireKeyParam = url.searchParams.get("hire");

  const now = new Date();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from =
    fromParam && !isNaN(Date.parse(fromParam))
      ? new Date(fromParam)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = toParam && !isNaN(Date.parse(toParam)) ? new Date(toParam) : now;

  const [entries, settings] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      take: 500,
      select: {
        date: true,
        hours: true,
        note: true,
        startTime: true,
        endTime: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.userAvailabilitySettings.findUnique({ where: { userId }, select: { timezone: true } }),
  ]);

  if (entries.length === 0) {
    return withCors(
      request,
      Response.json({ error: "No timesheet entries in range" }, { status: 404 }),
    );
  }

  const timezone = settings?.timezone ?? APPLICATION_TZ;

  const byKey = new Map<string, { label: string; entries: typeof entries }>();
  for (const e of entries) {
    const key = e.project?.id ?? UNASSIGNED_KEY;
    const label = e.project?.name ?? "DALI Hours";
    const bucket = byKey.get(key);
    if (bucket) bucket.entries.push(e);
    else byKey.set(key, { label, entries: [e] });
  }
  const availableHires = Array.from(byKey.entries()).map(([key, v]) => ({ key, label: v.label }));

  const hireKey = hireKeyParam && byKey.has(hireKeyParam) ? hireKeyParam : availableHires[0]!.key;
  const hire = byKey.get(hireKey)!;

  const payload = {
    hireKey,
    hireLabel: hire.label,
    from: from.toISOString(),
    to: to.toISOString(),
    availableHires,
    entries: hire.entries.map((e) => {
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
      return {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        description: e.note ?? "",
        projectLabel: hire.label,
      };
    }),
  };

  return withCors(request, Response.json(payload));
}
