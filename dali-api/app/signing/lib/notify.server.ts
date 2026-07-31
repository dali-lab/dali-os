// Fires the "document.sign_request" notification to the members who must sign a
// newly in-force agreement. Called when an admin puts a version in force. Only
// app-scoped ActiveMembers audiences are notified proactively; mentors and
// hiring-cycle confidentiality are still caught by their respective gates.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { activeMemberAudienceWhere } from "./state.server";

export async function notifySignRequest(bindingId: string): Promise<void> {
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      document: { select: { name: true, gateScope: true, audience: true } },
    },
  });
  if (!binding) return;
  if (binding.document.gateScope !== "App" || binding.document.audience !== "ActiveMembers") {
    return;
  }

  // Active, non-staff lab members who haven't already signed the in-force version.
  const [members, signed] = await Promise.all([
    prisma.dALIMember.findMany({
      where: activeMemberAudienceWhere,
      select: { userId: true },
    }),
    prisma.signingSignature.findMany({
      where: { bindingId, roleKey: "member", versionId: binding.versionId },
      select: { signerUserId: true },
    }),
  ]);
  const signedSet = new Set(signed.map((s) => s.signerUserId));
  const recipients = members
    .filter((m) => !signedSet.has(m.userId))
    .map((m) => ({ userId: m.userId }));
  if (recipients.length === 0) return;

  await notify({
    eventType: "document.sign_request",
    message: {
      title: `Please sign: ${binding.document.name}`,
      link: `/sign/${bindingId}`,
      isTodo: true,
    },
    recipients,
  });
}
