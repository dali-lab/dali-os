import type { Route } from "./+types/api.partner-applications.$id.status";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isPartnerApplicationStatus } from "../lib/partner-application";
import { setApplicationStatus } from "../lib/partner-activity.server";

// POST /api/partner-applications/:id/status
//
// Move an application to a different status column (board drag-and-drop, also
// used by the detail-page status dropdown). Body: { status }. Same permission
// model as application edit (isCore === Admin || Core).

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
  const status = (body as { status?: unknown } | null)?.status;
  if (!isPartnerApplicationStatus(status)) {
    return withCors(
      request,
      Response.json({ error: "Invalid status" }, { status: 400 }),
    );
  }

  const prev = await setApplicationStatus(prisma, {
    applicationId: params.id,
    to: status,
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
