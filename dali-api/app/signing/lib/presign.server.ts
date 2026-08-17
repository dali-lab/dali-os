// Records the pre-signed staff counter-signatures for a binding. The admin
// configures who counter-signs by placing "admin signature" fields in the
// agreement body; putting a version in force materializes one supervisor
// SigningSignature per configured signatory (idempotent). This replaces the
// old manual "counter-sign as supervisor" step.

import { prisma } from "~/lib/db";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { collectAdminSignatories, ADMIN_SIGNATURE_ROLE } from "~/lib/signing-fields";

/**
 * Upsert a supervisor counter-signature for every distinct admin-signature
 * signatory placed in the in-force version body. No-op when the body has none.
 * The signature carries no ip/userAgent — it's issued on the signatory's behalf
 * at bind time, not typed by them. Returns the number of signatories applied.
 */
export async function applyAdminSignatures(args: {
  bindingId: string;
  versionId: string;
  body: unknown;
}): Promise<number> {
  const signatories = collectAdminSignatories(ensureBlocks(args.body));
  for (const s of signatories) {
    await prisma.signingSignature.upsert({
      where: {
        bindingId_signerUserId_roleKey: {
          bindingId: args.bindingId,
          signerUserId: s.userId,
          roleKey: ADMIN_SIGNATURE_ROLE,
        },
      },
      create: {
        bindingId: args.bindingId,
        versionId: args.versionId,
        signerUserId: s.userId,
        roleKey: ADMIN_SIGNATURE_ROLE,
        typedName: s.name,
        ip: null,
        userAgent: null,
        fieldValues: {},
      },
      update: { versionId: args.versionId, typedName: s.name },
    });
  }
  return signatories.length;
}
