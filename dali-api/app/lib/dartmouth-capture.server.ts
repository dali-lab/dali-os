// dartmouth-capture.server.ts
//
// Runs after a Dartmouth-door magic-link verification is complete. Sets
// firstName/lastName/dartmouthEmail on the User row, records the proven
// address as a UserEmail alias, and binds a netId when the Dartmouth Email
// Addresses API can name the owner of that address.
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
import {
  findNetIdByAddress,
  emailAddressesByNetId,
  DartmouthEmailApiError,
} from "~/lib/dartmouth-email-addresses";
import { recordUserEmail } from "~/lib/user-email.server";
import { syncAndRecomputeMembershipStatus } from "~/lib/membership-status";

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

  // The magic link proved this mailbox, so the address is attached as verified
  // before anything else — a directory outage below must not cost us the one
  // fact we established for certain.
  const recorded = await recordUserEmail({
    userId,
    address: dartmouthEmail,
    verified: true,
  });
  if (!recorded.ok) {
    console.warn(
      `[dartmouth-capture] ${dartmouthEmail} already belongs to user ` +
        `${recorded.conflictUserId}; not reassigning to ${userId}`,
    );
  }

  // Attempt to bind the netId from the Dartmouth directory. A lookup failure
  // must NOT block account setup, but it is logged rather than swallowed: a
  // silent catch here is indistinguishable from "this person has no netID",
  // which is how an SSO gate on the directory would take out netID capture
  // without anyone noticing.
  let netId: string | null = null;
  try {
    netId = await findNetIdByAddress(dartmouthEmail);

    // Knowing the owner, collect the rest of their addresses in the same pass.
    // A Dartmouth person holds several working addresses and will not remember
    // which one they gave us — attaching them all now means any of them
    // resolves at the next sign-in, so new accounts never need the sweep that
    // exists to repair the old ones. Attested, not proven: the API says where
    // mail lands, and only the address just used by the magic link was read.
    if (netId) {
      for (const entry of await emailAddressesByNetId(netId)) {
        if (entry.address === dartmouthEmail) continue;
        const attached = await recordUserEmail({ userId, address: entry.address });
        if (!attached.ok) {
          console.warn(
            `[dartmouth-capture] ${entry.address} already belongs to user ` +
              `${attached.conflictUserId}; not reassigning to ${userId}`,
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof DartmouthEmailApiError) {
      console.error(`[dartmouth-capture] email API unavailable for ${userId}:`, err.message);
    } else {
      console.error(`[dartmouth-capture] netId binding failed for ${userId}:`, err);
    }
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
      // Recompute membership status now that a netId is bound — mirrors the CAS
      // callback, which fires this at the same point. Without it, status stays
      // uncomputed until the next daily membership-status-sync run. Fire-and-
      // forget: a sync failure must not block account setup.
      void syncAndRecomputeMembershipStatus(userId);
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
