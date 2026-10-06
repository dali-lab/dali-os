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
import { findNetIdByAddress } from "~/lib/dartmouth-people";

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
  if (owned?.user?.email) return normalizeEmailAddress(owned.user.email);

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
  if (user?.email) return normalizeEmailAddress(user.email);

  const healed = await healDartmouthAddress(address);
  return healed ?? address;
}

/**
 * Last resort for an unrecognised @dartmouth.edu address: ask Dartmouth who
 * owns it and attach it to that account.
 *
 * The migration can only backfill addresses we already held, and for a CAS-era
 * row that is the synthesized netid form — so the address a student actually
 * types resolves to nothing until something teaches us about it. The sweep does
 * that in bulk; this does it for whoever signs in first, and for anyone the
 * sweep never reached.
 *
 * The network call sits on a path that has already failed to resolve, so it
 * costs nothing when resolution succeeds and turns a dead end into a sign-in
 * when it doesn't. Every failure returns null and lets the caller fall through
 * to the neutral anti-enumeration response.
 */
async function healDartmouthAddress(address: string): Promise<string | null> {
  if (!address.endsWith("@dartmouth.edu")) return null;

  let netId: string | null = null;
  try {
    netId = await findNetIdByAddress(address);
  } catch (err) {
    console.error("[user-email] directory lookup failed while resolving:", err);
    return null;
  }
  if (!netId) return null;

  const owner = await prisma.user.findUnique({
    where: { netId },
    select: { id: true, email: true },
  });
  // A netid with no account here is a person we simply don't know; creating one
  // is sign-up's job, not resolution's.
  if (!owner) return null;

  const attached = await recordUserEmail({ userId: owner.id, address });
  if (!attached.ok) {
    console.warn(
      `[user-email] ${address} resolves to netid ${netId} but is held by user ` +
        `${attached.conflictUserId}; not reassigning`,
    );
    return null;
  }

  if (owner.email) return normalizeEmailAddress(owner.email);

  // No canonical email, so there is nothing to hand BetterAuth and an alias
  // alone cannot help — resolution returns this column. Dartmouth has just
  // attested that this address is theirs, so adopt it. Safe precisely because
  // the column is empty: nothing is overwritten, and a row that could never
  // sign in becomes one that can. Attestation still only decides where the
  // code goes; entering it is what proves the mailbox.
  try {
    await prisma.user.update({
      where: { id: owner.id },
      data: { email: address },
    });
    return address;
  } catch (err) {
    // Unique violation: another row already claims it as canonical. That is a
    // duplicate-account conflict to settle by hand, not to resolve by force.
    console.warn(`[user-email] could not adopt ${address} as canonical:`, err);
    return null;
  }
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

const DARTMOUTH_EMAIL_SUFFIX = "@dartmouth.edu";

/**
 * Batch address → user resolution for the applicant-email indexer: given a set
 * of addresses seen in mail headers, which DALI users do they belong to?
 *
 * Checked in order, cheapest first: the UserEmail alias table, then the
 * legacy identity columns (case-insensitive — some rows were populated before
 * everything funneled through normalizeEmailAddress), then NetID-form
 * `<netid>@dartmouth.edu` addresses that were never written anywhere but
 * match a User.netId directly. Returns normalized address -> userId; an
 * address nobody owns is simply absent from the map.
 */
export async function findUserIdsByAddresses(addresses: string[]): Promise<Map<string, string>> {
  const normalized = [...new Set(addresses.map(normalizeEmailAddress).filter(Boolean))];
  const result = new Map<string, string>();
  if (normalized.length === 0) return result;

  const aliasRows = await prisma.userEmail.findMany({
    where: { address: { in: normalized } },
    select: { address: true, userId: true },
  });
  for (const row of aliasRows) result.set(row.address, row.userId);

  const afterAlias = normalized.filter((a) => !result.has(a));
  if (afterAlias.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: afterAlias, mode: "insensitive" } },
          { daliEmail: { in: afterAlias, mode: "insensitive" } },
          { dartmouthEmail: { in: afterAlias, mode: "insensitive" } },
          { personalEmail: { in: afterAlias, mode: "insensitive" } },
        ],
      },
      select: { id: true, email: true, daliEmail: true, dartmouthEmail: true, personalEmail: true },
    });
    for (const u of users) {
      for (const column of [u.email, u.daliEmail, u.dartmouthEmail, u.personalEmail]) {
        if (!column) continue;
        const normalizedColumn = normalizeEmailAddress(column);
        if (!result.has(normalizedColumn) && afterAlias.includes(normalizedColumn)) {
          result.set(normalizedColumn, u.id);
        }
      }
    }
  }

  const afterColumns = normalized.filter(
    (a) => !result.has(a) && a.endsWith(DARTMOUTH_EMAIL_SUFFIX),
  );
  if (afterColumns.length > 0) {
    const netIds = afterColumns.map((a) => a.slice(0, -DARTMOUTH_EMAIL_SUFFIX.length));
    const users = await prisma.user.findMany({
      where: { netId: { in: netIds, mode: "insensitive" } },
      select: { id: true, netId: true },
    });
    for (const u of users) {
      if (!u.netId) continue;
      const address = `${u.netId.toLowerCase()}${DARTMOUTH_EMAIL_SUFFIX}`;
      if (!result.has(address) && afterColumns.includes(address)) result.set(address, u.id);
    }
  }

  return result;
}

/** Single-address convenience wrapper around findUserIdsByAddresses. */
export async function findUserIdByAddress(address: string): Promise<string | null> {
  const map = await findUserIdsByAddresses([address]);
  return map.get(normalizeEmailAddress(address)) ?? null;
}
