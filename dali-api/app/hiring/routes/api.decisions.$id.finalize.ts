import type { Route } from "./+types/api.decisions.$id.finalize";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const hiringLead = await isCore(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const member = await prisma.dALIMember.findUnique({ where: { userId: auth.user.sub } });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const decision = await prisma.decision.findUnique({
    where: { id: params.id },
    include: { domainApplication: { select: { application: { select: { applicationCycleId: true } } } } },
  });
  if (!decision) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (decision.stage !== "Draft") {
    return Response.json({ error: "Only Draft decisions can be finalized" }, { status: 409 });
  }
  if (decision.supersededAt !== null) {
    return Response.json({ error: "This Draft has been superseded" }, { status: 409 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    decision.domainApplication.application.applicationCycleId,
  );
  if (gate) return gate;

  // Supersede any prior non-superseded Final for this applicant before
  // creating the new one. The partial unique index requires the slot to be
  // free before insert. See api.delibs.$id.ts close-delibs for the same
  // pattern.
  const finalized = await prisma.$transaction(async (tx) => {
    const priorFinal = await tx.decision.findFirst({
      where: {
        domainApplicationId: decision.domainApplicationId,
        stage: "Final",
        supersededAt: null,
      },
      select: { id: true },
    });

    if (priorFinal) {
      await tx.decision.update({
        where: { id: priorFinal.id },
        data: { supersededAt: new Date() },
      });
    }

    const created = await tx.decision.create({
      data: {
        domainApplicationId: decision.domainApplicationId,
        type: decision.type,
        stage: "Final",
        madeById: auth.user.sub,
        notes: decision.notes,
        waitlistRank: decision.waitlistRank,
        parentDecisionId: decision.id,
      },
    });

    if (priorFinal) {
      await tx.decision.update({
        where: { id: priorFinal.id },
        data: { supersededById: created.id },
      });
    }

    return created;
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

  return Response.json(finalized, { status: 201 });
}
