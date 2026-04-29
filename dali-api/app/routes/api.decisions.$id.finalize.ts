import type { Route } from "./+types/api.decisions.$id.finalize";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const decision = await prisma.decision.findUnique({ where: { id: params.id } });
  if (!decision) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (decision.stage !== "Draft") {
    return Response.json({ error: "Only Draft decisions can be finalized" }, { status: 409 });
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

  return Response.json(finalized, { status: 201 });
}
