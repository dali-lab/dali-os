import type { Route } from "./+types/api.cycles.$cycleId.interview-config";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, hasCycleAccess } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: params.cycleId },
  });

  return withCors(request, Response.json(config));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isHiringLead(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const config = await prisma.interviewConfig.upsert({
    where: { applicationCycleId: params.cycleId },
    update: {
      slotDurationMinutes: body.slotDurationMinutes,
      bufferMinutes: body.bufferMinutes,
      dayStartHour: body.dayStartHour,
      dayEndHour: body.dayEndHour,
      interviewStartDate: new Date(body.interviewStartDate),
      interviewEndDate: new Date(body.interviewEndDate),
      rescheduleNoticeHours: body.rescheduleNoticeHours ?? 12,
      cancelNoticeHours: body.cancelNoticeHours ?? 0,
      timezone: body.timezone ?? "America/New_York",
    },
    create: {
      applicationCycleId: params.cycleId,
      slotDurationMinutes: body.slotDurationMinutes ?? 30,
      bufferMinutes: body.bufferMinutes ?? 15,
      dayStartHour: body.dayStartHour ?? 9,
      dayEndHour: body.dayEndHour ?? 18,
      interviewStartDate: new Date(body.interviewStartDate),
      interviewEndDate: new Date(body.interviewEndDate),
      rescheduleNoticeHours: body.rescheduleNoticeHours ?? 12,
      cancelNoticeHours: body.cancelNoticeHours ?? 0,
      timezone: body.timezone ?? "America/New_York",
    },
  });

  return withCors(request, Response.json(config));
}
