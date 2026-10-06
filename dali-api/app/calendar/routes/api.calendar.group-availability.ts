import type { Route } from "./+types/api.calendar.group-availability";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { computeUserFreeBusy } from "~/lib/availability";
import { buildAvailabilityDays } from "~/calendar/lib/availability-buckets.server";

const Schema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  weekStartIso: z.string().min(1),
  weekEndIso: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(480),
  timezone: z.string().min(1),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // POSTs only to carry the userIds/window body; it reads free/busy and writes
  // nothing, so it stays available to an impersonated (read-only) session.
  const auth = await requireAuth(request, { allowImpersonatedWrite: true });
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant")
    return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  const windowStart = new Date(body.weekStartIso);
  const windowEnd = new Date(body.weekEndIso);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
    return withCors(request, Response.json({ error: "Invalid window" }, { status: 400 }));
  }

  const userIds = Array.from(new Set(body.userIds));

  // Per-user: load availability inputs and compute busy/free.
  const perUser = await Promise.all(
    userIds.map((uid) => computeUserFreeBusy(uid, windowStart, windowEnd, body.timezone)),
  );

  const days = buildAvailabilityDays(perUser, {
    durationMinutes: body.durationMinutes,
    timezone: body.timezone,
  });

  // Per-user free intervals so the client can answer "who specifically is
  // available during the user-dragged window?" without a second round-trip.
  const perUserOut = perUser.map((u) => ({
    userId: u.userId,
    free: u.free.map((iv) => ({
      startIso: iv.start.toISOString(),
      endIso: iv.end.toISOString(),
    })),
    // Coverage: whether this user's free/busy is real (a linked calendar) or a
    // working-hours default. The client renders no-coverage users as
    // "unknown", never as free — see PerUserFree.
    hasCalendar: u.hasCalendar,
    calendarError: u.calendarError,
  }));

  return withCors(request, Response.json({ days, perUser: perUserOut }));
}
