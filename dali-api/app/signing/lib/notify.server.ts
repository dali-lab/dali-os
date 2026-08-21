// Fires the "document.sign_request" notification to everyone in a newly in-force
// agreement's audience. Called when an admin puts a version in force (and by the
// signing-issuance job when it materializes a new period's binding). Only
// app-enforced documents are notified proactively; hiring-cycle confidentiality
// is caught by its own gate (its resolver enumerates no one here).

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { AUDIENCE_RESOLVERS } from "./audiences";

export async function notifySignRequest(bindingId: string): Promise<void> {
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      termId: true,
      document: {
        select: { name: true, gateScope: true, audience: true, audienceGroupId: true },
      },
    },
  });
  if (!binding) return;
  if (binding.document.gateScope !== "App") return;

  // The document's audience, minus anyone who already signed the in-force version.
  const [audience, signed] = await Promise.all([
    AUDIENCE_RESOLVERS[binding.document.audience].listMembers({
      termId: binding.termId ?? undefined,
      audienceGroupId: binding.document.audienceGroupId,
    }),
    prisma.signingSignature.findMany({
      where: { bindingId, roleKey: "member", versionId: binding.versionId },
      select: { signerUserId: true },
    }),
  ]);
  const signedSet = new Set(signed.map((s) => s.signerUserId));
  const recipients = audience
    .filter((p) => !signedSet.has(p.id))
    .map((p) => ({ userId: p.id }));
  if (recipients.length === 0) return;

  await notify({
    eventType: "document.sign_request",
    message: {
      title: "You have a new document to sign",
      body: binding.document.name,
      link: `/sign/${bindingId}`,
      isTodo: true,
    },
    recipients,
  });
}
