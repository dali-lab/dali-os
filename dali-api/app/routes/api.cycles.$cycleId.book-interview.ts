import type { Route } from "./+types/api.cycles.$cycleId.book-interview";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignInterviewers } from "~/lib/scheduling";
import { provisionZoomMeeting } from "~/lib/zoom";
import { checkRateLimit } from "~/lib/rate-limit";
import { safeJson } from "~/lib/safe-json";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const rateLimited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub);
  if (rateLimited) return withCors(request, rateLimited);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await safeJson<{ slotStart: string; slotEnd: string; domainApplicationId: string; mode?: string }>(request);
  if (body instanceof Response) return withCors(request, body);
  const { slotStart, slotEnd, domainApplicationId, mode } = body;
  const interviewMode = mode === "in-person" ? "in-person" as const : "online" as const;

  if (!slotStart || !slotEnd || !domainApplicationId) {
    return withCors(request, Response.json({ error: "slotStart, slotEnd, and domainApplicationId required" }, { status: 400 }));
  }

  const domainApplication = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: {
      challengeVersion: true,
      application: { select: { userId: true } },
    },
  });

  if (!domainApplication) {
    return withCors(request, Response.json({ error: "DomainApplication not found" }, { status: 404 }));
  }

  if (domainApplication.application.userId !== auth.user.sub) {
    return withCors(request, Response.json({ error: "Not your application" }, { status: 403 }));
  }

  const applicantDomainIds = [domainApplication.challengeVersion.domainId];

  try {
    const interview = await assignInterviewers(
      params.cycleId!,
      domainApplicationId,
      applicantDomainIds,
      new Date(slotStart),
      new Date(slotEnd),
      undefined,
      interviewMode,
    );

    if (interview.location === "Online") {
      try {
        const duration = Math.round((new Date(slotEnd).getTime() - new Date(slotStart).getTime()) / 60_000);
        await provisionZoomMeeting(interview.id, "DALI Lab Interview", new Date(slotStart), duration);
      } catch (err) {
        console.error("Failed to provision Zoom meeting:", err);
      }
    }

    return withCors(request, Response.json(interview, { status: 201 }));
  } catch (err: any) {
    return withCors(request, Response.json({ error: err.message }, { status: 409 }));
  }
}
