import type { Route } from "./+types/api.offerings.$id.publish";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { setOfferingStatus } from "~/education/lib/offerings-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (status !== "Draft" && status !== "Published" && status !== "Archived") {
    return Response.json({ error: "status must be Draft, Published, or Archived" }, { status: 400 });
  }

  try {
    const updated = await setOfferingStatus(params.id, status);
    await logAuditEvent({
      action: "education.offering.status",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { status },
      request,
    });
    return Response.json(updated);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid transition" },
      { status: 409 },
    );
  }
}
