import type { Route } from "./+types/api.decisions.$id.finalize";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return withAuth(auth, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  const decision = await prisma.decision.findUnique({ where: { id: params.id } });
  if (!decision) {
    return withAuth(auth, Response.json({ error: "Decision not found" }, { status: 404 }));
  }
  if (decision.stage !== "Draft") {
    return withAuth(auth, Response.json({ error: "Only Draft decisions can be finalized" }, { status: 409 }));
  }

  const finalized = await prisma.decision.create({
    data: {
      domainApplicationId: decision.domainApplicationId,
      type: decision.type,
      stage: "Final",
      madeById: member.id,
      notes: decision.notes,
      waitlistRank: decision.waitlistRank,
      parentDecisionId: decision.id,
    },
  });

  await logAuditEvent({
    action: "decision.finalize",
    userId: auth.user.sub,
    targetId: finalized.id,
    metadata: {
      decisionId: finalized.id,
      parentDecisionId: decision.id,
      domainApplicationId: decision.domainApplicationId,
      type: finalized.type,
    },
    request,
  });

  return withAuth(auth, Response.json(finalized, { status: 201 }));
}
