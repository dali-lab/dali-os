import type { Route } from "./+types/api.applications.decisions.bulk";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { decideApplication } from "~/education/lib/decisions";
import { logAuditEvent } from "~/lib/audit";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

const VALID = new Set<EduApplicationStatus>(["Approved", "Rejected", "Waitlisted"]);

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === "string") : [];
  const status = body?.status as EduApplicationStatus | undefined;
  if (ids.length === 0) {
    return Response.json({ error: "ids array required" }, { status: 400 });
  }
  if (!status || !VALID.has(status)) {
    return Response.json({ error: `status must be one of ${[...VALID].join(", ")}` }, { status: 400 });
  }

  // Group ids by offering for one permission check per offering.
  const apps = await prisma.educationApplication.findMany({
    where: { id: { in: ids } },
    select: { id: true, offeringId: true },
  });
  const offerings = new Set(apps.map((a) => a.offeringId));
  for (const offeringId of offerings) {
    if (!(await canManageOffering(auth.user.sub, offeringId))) {
      return Response.json({ error: "Forbidden on at least one offering" }, { status: 403 });
    }
  }

  const outcomes = [];
  for (const id of ids) {
    const outcome = await decideApplication({
      applicationId: id,
      targetStatus: status,
      actorUserId: auth.user.sub,
    });
    if (outcome) outcomes.push(outcome);
  }

  await logAuditEvent({
    action: "education.application.decision.bulk",
    userId: auth.user.sub,
    metadata: { status, count: outcomes.length },
    request,
  });

  return Response.json({ outcomes });
}
