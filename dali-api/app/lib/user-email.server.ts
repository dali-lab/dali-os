// Address → user resolution for sign-in.
//
// One question, one answer: given whatever address a person typed, which
// account is it? Before this existed, every caller re-implemented the question
// as a four-column OR over User (email/daliEmail/dartmouthEmail/personalEmail),
// which can only ever match an address we happened to store. A Dartmouth
// student owns at least two working addresses — the NetID-form alias CAS
// synthesized and the name-form identity address the directory publishes — and
// the columns hold one of them. Typing the other resolved to nobody.
//
// UserEmail is the superset that resolves. User.email stays BetterAuth's single
// canonical identifier (it has no multi-email concept), so resolution maps an
// alias TO that canonical value and hands BetterAuth an address it can find.

import { prisma } from "~/lib/db";

/** Trimmed + lowercased. The only form ever written to UserEmail.address. */
export function normalizeEmailAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The canonical login address for whatever the user typed.
 *
 * Falls through to the normalized input when the address resolves to nobody,
 * which keeps the caller's anti-enumeration behaviour intact: the downstream
 * emailOTP no-op (disableSignUp) stays neutral and never reveals whether an
 * account exists. A user row with a null `email` also falls through rather than
 * returning null, so the caller always has something to hand BetterAuth.
 */
export async function resolveLoginIdentifier(typed: string): Promise<string> {
  const address = normalizeEmailAddress(typed);
  if (address === "") return address;

  const owned = await prisma.userEmail.findUnique({
    where: { address },
    select: { user: { select: { email: true } } },
  });
  if (owned?.user.email) return normalizeEmailAddress(owned.user.email);

  // Not in the alias table yet. Fall back to the legacy columns so resolution
  // still works for any row written between the migration's backfill and this
  // code path taking over every write site.
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: address },
        { daliEmail: address },
        { dartmouthEmail: address },
        { personalEmail: address },
      ],
    },
    select: { email: true },
  });
  return user?.email ? normalizeEmailAddress(user.email) : address;
}

export type RecordEmailResult =
  | { ok: true; created: boolean }
  /** The address is already held by a DIFFERENT user. Never reassigned here. */
  | { ok: false; conflictUserId: string };

/**
 * Attach an address to a user, idempotently.
 *
 * Refuses to move an address that already belongs to someone else. Two rows
 * claiming one mailbox is a real identity conflict (usually a duplicate account
 * from the CAS/BetterAuth overlap) and silently re-pointing it would hand one
 * person's mail to the other — the caller decides what to do instead.
 */
export async function recordUserEmail(args: {
  userId: string;
  address: string;
  /** True only when control of THIS mailbox was proven, never for attestation. */
  verified?: boolean;
}): Promise<RecordEmailResult> {
  const address = normalizeEmailAddress(args.address);
  const existing = await prisma.userEmail.findUnique({
    where: { address },
    select: { userId: true, verifiedAt: true },
  });

  if (existing && existing.userId !== args.userId) {
    return { ok: false, conflictUserId: existing.userId };
  }

  if (existing) {
    // Proof is one-way: once a mailbox is proven it stays proven, and an
    // unproven re-record (a directory sweep re-run) must not clear it.
    if (args.verified && existing.verifiedAt === null) {
      await prisma.userEmail.update({
        where: { address },
        data: { verifiedAt: new Date() },
      });
    }
    return { ok: true, created: false };
  }

  await prisma.userEmail.create({
    data: {
      userId: args.userId,
      address,
      verifiedAt: args.verified ? new Date() : null,
    },
  });
  return { ok: true, created: true };
}

/**
 * Record that a code or magic link sent to this address was actually used.
 * No-op for an address we don't hold — proof of an unknown mailbox tells us
 * nothing about who owns it.
 */
export async function markEmailProven(address: string): Promise<void> {
  await prisma.userEmail.updateMany({
    where: { address: normalizeEmailAddress(address), verifiedAt: null },
    data: { verifiedAt: new Date() },
  });
}
