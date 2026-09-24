// dartmouth-capture.server.ts
//
// Runs after a Dartmouth-door magic-link verification is complete. Sets
// firstName/lastName/dartmouthEmail on the User row and, if the Dartmouth
// directory lookup can bind a netId from the verified email, writes that too.
//
// Setting `dartmouthEmail` is the definitive "dartmouth" signal for
// betterauth-compat.server.ts type derivation — a user whose netId lookup
// missed is still correctly classified as "dartmouth" rather than "partner".
//
// Same-person cross-row merge (a legacy CAS user row with the same netId
// alongside this new BetterAuth row) is a documented follow-up:
// see app/lib/linking.ts (Phase 2). We detect the collision via P2002 and
// retry without the conflicting netId so the door never dead-ends the user.

import { prisma } from "~/lib/db";
import { bindNetIdByEmail } from "~/lib/dartmouth-lookup";

export type CaptureResult = {
  netIdCaptured: boolean;
};

export async function captureDartmouthIdentity(args: {
  userId: string;
  fullName: string;
  verifiedEmail: string;
}): Promise<CaptureResult> {
  const { userId, fullName, verifiedEmail } = args;

  // Split name into first/last: first token is firstName, rest is lastName.
  // A single-token name gets an empty lastName string.
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const firstName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const lastName = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  const dartmouthEmail = verifiedEmail.toLowerCase();

  // Attempt to bind the netId from the Dartmouth directory.  A lookup failure
  // (network error, unexpected response) must NOT block account setup.
  let netId: string | null = null;
  try {
    const match = await bindNetIdByEmail(fullName, verifiedEmail);
    if (match) netId = match.netId;
  } catch {
    // Lookup failure is non-fatal — dartmouthEmail alone classifies the user.
  }

  // Write names + dartmouthEmail (always) and netId (when found).
  // On a P2002 unique-constraint violation for netId (another User row already
  // holds it — a legacy CAS account for the same person), retry without netId.
  // The merge of these two rows is out of scope here (see lib/linking.ts).
  if (netId) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { firstName, lastName, dartmouthEmail, netId },
      });
      return { netIdCaptured: true };
    } catch (err) {
      const isUniqueViolation =
        typeof err === "object" &&
        err !== null &&
        (err as { code?: unknown }).code === "P2002";
      if (!isUniqueViolation) throw err;
      // Fall through to the retry-without-netId path below.
    }
  }

  // Either no netId was found, or the netId write collided — write without it.
  await prisma.user.update({
    where: { id: userId },
    data: { firstName, lastName, dartmouthEmail },
  });
  return { netIdCaptured: false };
}
