import type { Route } from "./+types/api.cycles.$cycleId.book-interview";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignInterviewers } from "~/hiring/lib/scheduling";
import { checkRateLimit } from "~/lib/rate-limit";
import { parseJson } from "~/lib/validate";

const BookInterviewSchema = z
  .object({
    slotStart: z.string().datetime({ offset: true }),
    slotEnd: z.string().datetime({ offset: true }),
    domainApplicationId: z.string().min(1).max(100),
  })
  .refine((v) => new Date(v.slotEnd) > new Date(v.slotStart), {
    message: "slotEnd must be after slotStart",
  });

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const rateLimited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub);
  if (rateLimited) return withAuth(auth, withCors(request, rateLimited));

  if (request.method !== "POST") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const body = await parseJson(request, BookInterviewSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));
  const { slotStart, slotEnd, domainApplicationId } = body;

  const domainApplication = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: {
      challengeVersion: true,
      application: { select: { userId: true } },
    },
  });

  if (!domainApplication) {
    return withAuth(auth, withCors(request, Response.json({ error: "DomainApplication not found" }, { status: 404 })));
  }

  if (domainApplication.application.userId !== auth.user.sub) {
    return withAuth(auth, withCors(request, Response.json({ error: "Not your application" }, { status: 403 })));
  }

  const applicantDomainIds = [domainApplication.challengeVersion.domainId];

  try {
    const interview = await assignInterviewers(
      params.cycleId!,
      domainApplicationId,
      applicantDomainIds,
      new Date(slotStart),
      new Date(slotEnd),
    );
    return withAuth(auth, withCors(request, Response.json(interview, { status: 201 })));
  } catch (err: any) {
    return withAuth(auth, withCors(request, Response.json({ error: err.message }, { status: 409 })));
  }
}
