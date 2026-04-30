import type { Route } from "./+types/api.cycles.$cycleId.confidentiality.sign";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cycleId = params.cycleId!;
  const binding = await prisma.cycleConfidentialityAgreement.findUnique({
    where: { applicationCycleId: cycleId },
    select: { confidentialityAgreementVersionId: true },
  });
  if (!binding) {
    return Response.json(
      { error: "No confidentiality agreement is bound to this cycle" },
      { status: 409 },
    );
  }

  const versionId = binding.confidentialityAgreementVersionId;

  // Idempotent: if a row already exists for this user+cycle, replace it so the
  // user is recorded as having signed the currently-bound version.
  const signature = await prisma.confidentialityAgreementSignature.upsert({
    where: {
      userId_applicationCycleId: {
        userId: auth.user.sub,
        applicationCycleId: cycleId,
      },
    },
    create: {
      userId: auth.user.sub,
      applicationCycleId: cycleId,
      confidentialityAgreementVersionId: versionId,
    },
    update: {
      confidentialityAgreementVersionId: versionId,
      signedAt: new Date(),
    },
  });

  await logAuditEvent({
    action: "confidentiality.sign",
    userId: auth.user.sub,
    targetId: cycleId,
    metadata: { versionId },
    request,
  });

  return Response.json({ ok: true, signatureId: signature.id });
}
