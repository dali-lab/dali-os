import { prisma } from "~/lib/db";

// The partner contract runs on the shared signing engine. "Sending" a contract
// instances the published PartnerContract template as a per-application
// SigningBinding (scopeKey "partner-app:<id>"); the partner then signs it in the
// portal via recordSignature, exactly like the other agreements.

export async function sendPartnerContract(
  applicationId: string,
): Promise<{ ok: true; bindingId: string } | { ok: false; error: string }> {
  // The in-force partner contract template = the most recently updated,
  // non-archived PartnerContract document that has a published version.
  const doc = await prisma.signingDocument.findFirst({
    where: {
      kind: "PartnerContract",
      archivedAt: null,
      versions: { some: { publishedAt: { not: null } } },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  const versionId = doc?.versions[0]?.id;
  if (!doc || !versionId) {
    return {
      ok: false,
      error:
        "No published partner contract template. Create and publish one in Admin → Agreements first.",
    };
  }

  const scopeKey = `partner-app:${applicationId}`;
  const binding = await prisma.signingBinding.upsert({
    where: { documentId_scopeKey: { documentId: doc.id, scopeKey } },
    // Re-sending picks up the latest published template version.
    create: { documentId: doc.id, versionId, scopeKey, applicationId },
    update: { versionId },
    select: { id: true },
  });

  await prisma.partnerApplication.update({
    where: { id: applicationId },
    data: { contractBindingId: binding.id, contractSentAt: new Date() },
  });
  return { ok: true, bindingId: binding.id };
}

// Has this user already signed the application's contract? (roleKey "member" —
// the template's partner fields use that role, so the shared engine is untouched.)
export async function partnerContractSignature(
  bindingId: string,
  userId: string,
): Promise<{ signedAt: Date; typedName: string } | null> {
  const sig = await prisma.signingSignature.findFirst({
    where: { bindingId, signerUserId: userId, roleKey: "member" },
    select: { signedAt: true, typedName: true },
  });
  return sig ? { signedAt: sig.signedAt, typedName: sig.typedName } : null;
}
