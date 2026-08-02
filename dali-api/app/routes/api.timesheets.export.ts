import type { Route } from "./+types/api.timesheets.export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { resolveUserTimeZone, zonedDayStartUtc } from "~/lib/timezone";
import { getRoleLabel, getUserRoleInstances } from "~/lib/roles";

// Export the caller's Timesheet-tab entries in the shape the JobX browser
// extension (jobx-extension/) consumes:
//   { hireLabel, entries: [{ startAt, endAt, description, projectLabel }] }
//
// JobX timesheets are per-job, so the extension fills one "hire" at a time.
// Bucketed by (assignmentType, roleRefId) — the concrete paid role a
// TimeEntry is attributed to (see app/lib/roles.ts#getUserRoleInstances) —
// plus a catch-all "unassigned" bucket for legacy/unattributed entries. Pass
// ?hire=<roleRefId or "unassigned"> to pick which bucket to export; omit it
// to export the member's first available bucket. ?from / ?to (ISO dates)
// bound the window; default is the last 30 days, which comfortably covers a
// JobX pay period.
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

  const [entries, settings, userRow] = await Promise.all([
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
        assignmentType: true,
        roleRefId: true,
      },
    }),
    prisma.userAvailabilitySettings.findUnique({ where: { userId }, select: { timezone: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);

  if (entries.length === 0) {
    return withCors(
      request,
      Response.json({ error: "No timesheet entries in range" }, { status: 404 }),
    );
  }

  // Working hours are interpreted in the availability-settings zone when set;
  // otherwise fall back to the user's own display zone rather than a hardcoded ET.
  const timezone = settings?.timezone ?? resolveUserTimeZone(userRow);

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
  // logged in this window. Deriving the list from `entries` alone hid roles a
  // member has been hired into but hasn't logged against yet — which is
  // precisely when they need to pick one in JobX. Buckets with entries keep
  // their computed label; the rest come from the role registry with no
  // entries, so switching to one shows an empty (but selectable) timesheet.
  const roleInstances = await getUserRoleInstances(userId);
  for (const role of roleInstances) {
    if (byKey.has(role.roleRefId)) continue;
    byKey.set(role.roleRefId, { label: role.label, entries: [] });
  }
  const availableHires = Array.from(byKey.entries()).map(([key, v]) => ({ key, label: v.label }));

  // Default to a bucket that actually has hours — landing on an empty role
  // just because it sorts first would look like the pull had failed.
  const firstWithEntries = availableHires.find((h) => (byKey.get(h.key)?.entries.length ?? 0) > 0);
  const hireKey =
    hireKeyParam && byKey.has(hireKeyParam)
      ? hireKeyParam
      : (firstWithEntries?.key ?? availableHires[0]!.key);
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
