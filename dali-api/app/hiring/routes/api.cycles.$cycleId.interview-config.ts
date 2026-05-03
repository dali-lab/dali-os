import type { Route } from "./+types/api.cycles.$cycleId.interview-config";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, hasCycleAccess } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { isValidTimezone } from "~/lib/timezone";

const InterviewConfigSchema = z
  .object({
    slotDurationMinutes: z.number().int().min(5).max(240).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
    dayStartHour: z.number().int().min(0).max(23).optional(),
    dayEndHour: z.number().int().min(0).max(23).optional(),
    interviewStartDate: z.string().datetime({ offset: true }),
    interviewEndDate: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(100).optional(),
  })
  .refine(
    (v) =>
      v.dayStartHour === undefined ||
      v.dayEndHour === undefined ||
      v.dayStartHour < v.dayEndHour,
    { message: "dayStartHour must be less than dayEndHour" },
  )
  .refine(
    (v) => new Date(v.interviewEndDate) >= new Date(v.interviewStartDate),
    { message: "interviewEndDate must be on or after interviewStartDate" },
  );

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: params.cycleId },
  });

  return withAuth(auth, withCors(request, Response.json(config)));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isHiringLead(auth.user.sub))) return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  if (request.method !== "POST") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const body = await parseJson(request, InterviewConfigSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));

  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
    return withAuth(auth, withCors(request, Response.json({ error: "Invalid timezone" }, { status: 400 })));
  }

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

  return withAuth(auth, withCors(request, Response.json(config)));
}
