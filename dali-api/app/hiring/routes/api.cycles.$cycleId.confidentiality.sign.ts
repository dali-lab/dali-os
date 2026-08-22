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
  const binding = await prisma.signingBinding.findFirst({
    where: { cycleId, document: { gateScope: "HiringCycle" } },
    select: { id: true, versionId: true },
  });
  if (!binding) {
    return Response.json(
      { error: "No confidentiality agreement is bound to this cycle" },
      { status: 409 },
    );
  }

  const versionId = binding.versionId;
  const signer = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });

  // Idempotent: if a row already exists for this user+binding, replace it so the
  // user is recorded as having signed the currently-bound version.
  const signature = await prisma.signingSignature.upsert({
    where: {
      bindingId_signerUserId_roleKey: {
        bindingId: binding.id,
        signerUserId: auth.user.sub,
        roleKey: "member",
      },
    },
    create: {
      bindingId: binding.id,
      versionId,
      signerUserId: auth.user.sub,
      roleKey: "member",
      typedName: signer ? `${signer.firstName} ${signer.lastName}`.trim() : "",
      ip:
        request.headers.get("fly-client-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        null,
      userAgent: request.headers.get("user-agent") || null,
      fieldValues: {},
    },
    update: { versionId, signedAt: new Date() },
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
