import type { Route } from "./+types/api.partner-applications.$id.status";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isPartnerApplicationStatus } from "../lib/partner-application";

// POST /api/partner-applications/:id/status
//
// Move an application to a different status column (board drag-and-drop, also
// used by the detail-page status dropdown). Body: { status }. Same permission
// model as application edit (isHiringLead === Admin || Core).

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
  if (!(await isHiringLead(auth.user.sub))) {
    return withCors(
      request,
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.partnerApplication as any).update({
      where: { id: params.id },
      data: { status },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return withCors(
        request,
        Response.json({ error: "Application not found" }, { status: 404 }),
      );
    }
    throw e;
  }

  return withCors(request, Response.json({ ok: true }));
}
