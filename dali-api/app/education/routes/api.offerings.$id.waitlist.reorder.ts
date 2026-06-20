import type { Route } from "./+types/api.offerings.$id.waitlist.reorder";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
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
  const ids = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === "string") : [];
  if (ids.length === 0) {
    return Response.json({ error: "ids array required" }, { status: 400 });
  }

  // Confirm every id belongs to this offering and is Waitlisted.
  const rows = await prisma.educationApplication.findMany({
    where: { id: { in: ids }, offeringId: params.id, status: "Waitlisted" },
    select: { id: true },
  });
  if (rows.length !== ids.length) {
    return Response.json({ error: "Some ids are not Waitlisted on this offering" }, { status: 400 });
  }

  // Re-stamp waitlistRank in 10-step increments so a single up/down swap
  // can squeeze between without re-stamping the whole list.
  for (let i = 0; i < ids.length; i++) {
    await prisma.educationApplication.update({
      where: { id: ids[i] },
      data: { waitlistRank: (i + 1) * 10 },
    });
  }

  await logAuditEvent({
    action: "education.waitlist.reorder",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { count: ids.length },
    request,
  });

  return Response.json({ ok: true, count: ids.length });
}
