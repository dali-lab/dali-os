import type { Route } from "./+types/api.mobile.time";
import { prisma } from "~/lib/db.server";
import { getUserRoleInstances } from "~/lib/roles";
import { payPeriodFor } from "~/lib/pay-period";
import { resolveUserTimeZone } from "~/lib/timezone";
import { parseJson } from "~/lib/validate";
import { AddTimeEntrySchema } from "~/lib/calendar-schemas";
import { addTimeEntry } from "~/lib/time-entries.server";
import { assignmentTypeLabel, entryDayKey, todayKey, utcDayKey } from "~/lib/mobile-format";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const AddBodySchema = AddTimeEntrySchema.omit({ intent: true });

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  const timeZone = resolveUserTimeZone(user);
  const today = todayKey(new Date(), timeZone);
  const requested = new URL(request.url).searchParams.get("date");
  if (requested && !DAY_KEY.test(requested)) return mobileError("date must be yyyy-MM-dd", 400);
  const period = payPeriodFor(new Date(`${requested ?? today}T00:00:00.000Z`));
  const startKey = utcDayKey(period.start);
  const endKey = utcDayKey(period.end);

  const [roles, rows] = await Promise.all([
    getUserRoleInstances(userId, undefined, request),
    // A day of slack on each side: a Meeting entry's date is an instant, which
    // can sit on the neighboring UTC day of the member's local one.
    prisma.timeEntry.findMany({
      where: {
        userId,
        date: { gte: new Date(period.start.getTime() - DAY_MS), lt: new Date(period.end.getTime() + 2 * DAY_MS) },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        source: true,
        date: true,
        hours: true,
        note: true,
        startTime: true,
        endTime: true,
        assignmentType: true,
        roleRefId: true,
        projectId: true,
        scheduledMeetingId: true,
        occurrenceStart: true,
        meeting: { select: { title: true } },
      },
    }),
  ]);

  const entries = rows
    .map((r) => ({ row: r, day: entryDayKey(r, timeZone) }))
    .filter(({ day }) => day >= startKey && day <= endKey)
    .map(({ row, day }) => ({
      id: row.id,
      source: row.source,
      day,
      hours: row.hours,
      note: row.note,
      startTime: row.startTime?.toISOString() ?? null,
      endTime: row.endTime?.toISOString() ?? null,
      assignmentType: row.assignmentType,
      roleRefId: row.roleRefId,
      projectId: row.projectId,
      scheduledMeetingId: row.scheduledMeetingId,
      occurrenceStart: row.occurrenceStart?.toISOString() ?? null,
      meetingTitle: row.meeting?.title ?? null,
    }));

  return mobileJson({
    today,
    period: { start: startKey, end: endKey },
    roles: roles.map((r) => ({
      assignmentType: r.assignmentType,
      roleRefId: r.roleRefId,
      label: r.label,
      detail: assignmentTypeLabel(r.assignmentType),
      projectId: r.projectId ?? null,
    })),
    entries,
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const body = await parseJson(request, AddBodySchema);
  if (body instanceof Response) return body;
  const result = await addTimeEntry(guard.userId, body);
  if (!result.ok) return mobileError(result.error, result.status);
  return mobileJson({ id: result.entry.id }, { status: 201 });
}
