import type { Route } from "./+types/api.partner-applications.$id.status";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isPartnerStage } from "../lib/partner-application";
import { setApplicationStage } from "../lib/partner-activity.server";

// POST /api/partner-applications/:id/status
//
// Move an application to a different stage column (board drag-and-drop, also
// used by the detail-page stage dropdown). Body: { stage } — { status } is
// accepted as a legacy alias for the same value. Same permission model as
// application edit (isCore === Admin || Core).

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      Response.json({ error: "Invalid JSON" }, { status: 400 }),
    );
  }
  const parsed = body as { stage?: unknown; status?: unknown } | null;
  const stage = parsed?.stage ?? parsed?.status;
  if (!isPartnerStage(stage)) {
    return withCors(
      request,
      Response.json({ error: "Invalid stage" }, { status: 400 }),
    );
  }

  const prev = await setApplicationStage(prisma, {
    applicationId: params.id,
    to: stage,
    actorUserId: auth.user.sub,
  });
  if (prev === null) {
    return withCors(
      request,
      Response.json({ error: "Application not found" }, { status: 404 }),
    );
  }

  return withCors(request, Response.json({ ok: true }));
}
