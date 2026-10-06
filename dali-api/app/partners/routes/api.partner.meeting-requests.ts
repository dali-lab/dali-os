import type { Route } from "./+types/api.partner.meeting-requests";
import { z } from "zod";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { createMeetingRequest } from "~/partners/lib/partner-meetings.server";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

// POST /api/partner/meeting-requests
//
// A partner submits a time picked on the portal's real-scheduler grid.
// Body: { applicationId | projectId, startTime, durationMinutes, note? }.

const Schema = z
  .object({
    applicationId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    startTime: z.string().datetime(),
    durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
    note: z.string().trim().max(2000).optional(),
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

  const startTime = new Date(body.startTime);
  if (isNaN(startTime.getTime()) || startTime.getTime() <= Date.now()) {
    return withCors(request, Response.json({ error: "startTime must be in the future" }, { status: 400 }));
  }

  const result = await createMeetingRequest({
    contactId: ctx.contact.id,
    applicationId: body.applicationId ?? null,
    projectId: body.projectId ?? null,
    startTime,
    durationMinutes: body.durationMinutes,
    note: body.note,
  });

  return withCors(request, Response.json({ ok: true, id: result.id }, { status: 201 }));
}
