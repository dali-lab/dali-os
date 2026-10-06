import type { Route } from "./+types/api.partner.availability";
import { z } from "zod";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { resolveMeetingParticipantIds } from "~/partners/lib/partner-meetings.server";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { computeUserFreeBusy } from "~/lib/availability";
import { buildAvailabilityDays } from "~/calendar/lib/availability-buckets.server";

// POST /api/partner/availability
//
// The portal's real-scheduler grid. Resolves the team's participant ids
// server-side (never sent to the client) and returns only the merged
// {days} — same shape as /api/calendar/group-availability minus `perUser`,
// so ScheduleWeekGrid renders its aggregate-only view. A partner can never
// see per-member calendars (specs/partner-crm.md §6).

const Schema = z
  .object({
    applicationId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    weekStartIso: z.string().min(1),
    weekEndIso: z.string().min(1),
    durationMinutes: z.number().int().min(5).max(480),
    timezone: z.string().min(1),
  })
  .refine((v) => !!v.applicationId !== !!v.projectId, {
    message: "Exactly one of applicationId or projectId is required",
  });

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const ctx = await requirePartnerAccount(request);

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  if (body.applicationId) {
    const owns = await prisma.partnerApplication.findFirst({
      where: { id: body.applicationId, applicantContactId: ctx.contact.id },
      select: { id: true },
    });
    if (!owns) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  } else if (body.projectId) {
    const access = await partnerHasProjectAccess(ctx.auth.user.sub, body.projectId);
    if (!access) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const windowStart = new Date(body.weekStartIso);
  const windowEnd = new Date(body.weekEndIso);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
    return withCors(request, Response.json({ error: "Invalid window" }, { status: 400 }));
  }

  const participantUserIds = await resolveMeetingParticipantIds({
    applicationId: body.applicationId ?? null,
    projectId: body.projectId ?? null,
  });

  const perUser = await Promise.all(
    participantUserIds.map((uid) => computeUserFreeBusy(uid, windowStart, windowEnd, body.timezone)),
  );

  const days = buildAvailabilityDays(perUser, {
    durationMinutes: body.durationMinutes,
    timezone: body.timezone,
  });

  return withCors(request, Response.json({ days }));
}
