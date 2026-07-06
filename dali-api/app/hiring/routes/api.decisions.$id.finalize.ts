import type { Route } from "./+types/api.decisions.$id.finalize";
import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead, requireMemberSession } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

// Thrown inside the finalize transaction when a Final/Released decision already
// exists, to bail out without creating a duplicate. Caught + mapped to a 409.
class AlreadyFinalizedError extends Error {}

export async function action({ request, params }: Route.ActionArgs) {
  const roleGate = await requireCoreOrDomainLead(request);
  if (!roleGate.ok) return roleGate.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const memberGate = await requireMemberSession(request);
  if (!memberGate.ok) return memberGate.response;
  const auth = memberGate.auth;

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

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    decision.domainApplication.application.applicationCycleId,
  );
  if (gate) return gate;

  // Decision is append-only, so finalizing creates a new Final row. Guard
  // against producing duplicates when this draft is finalized more than once
  // (e.g. a double-click before the UI revalidates, or two concurrent requests):
  // if a Final/Released decision of this type already exists for the
  // domainApplication, there's nothing to finalize. The check + create run in a
  // transaction so two simultaneous requests can't both pass the check.
  let finalized;
  try {
    finalized = await prisma.$transaction(async (tx) => {
      const existing = await tx.decision.findFirst({
        where: {
          domainApplicationId: decision.domainApplicationId,
          type: decision.type,
          stage: { in: ["Final", "Released"] },
        },
        select: { id: true },
      });
      if (existing) {
        throw new AlreadyFinalizedError();
      }
      return tx.decision.create({
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
    });
  } catch (err) {
    if (err instanceof AlreadyFinalizedError) {
      return Response.json(
        { error: "This decision has already been finalized." },
        { status: 409 },
      );
    }
    throw err;
  }

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
