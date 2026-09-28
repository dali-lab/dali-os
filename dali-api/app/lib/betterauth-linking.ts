// Pure decision logic for the BetterAuth email backfill + account-linking script
// (prisma/scripts/backfill-betterauth-email.ts). No Prisma import, no side
// effects — kept here so the rules are unit-testable without a DB.
//
// See specs/betterauth-email-linking.md for the why.

// The address columns on User that can identify a person, in canonical-email
// priority order. `email` is the login identifier; the other three are the
// recorded aliases the login resolver also matches.
export const IDENTITY_EMAIL_FIELDS = [
  "daliEmail",
  "dartmouthEmail",
  "personalEmail",
] as const;

export type IdentityEmails = {
  email: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
};

// Canonical login email: @dali first (a member's "dali one"), then @dartmouth,
// then personal. Decision #3 (Kiran, 2026-09-24): @dali first — it is the
// address members know as their login and it persists through their tenure.
export function resolveCanonicalEmail(user: {
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
}): string | null {
  return user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail ?? null;
}

export function resolveName(user: {
  firstName: string;
  lastName: string;
}): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

// Every non-null address on a row, lowercased — across ALL four columns
// (including canonical `email`). Used to find rows that share a real address.
export function collectAddresses(user: IdentityEmails): string[] {
  const out: string[] = [];
  for (const v of [
    user.email,
    user.daliEmail,
    user.dartmouthEmail,
    user.personalEmail,
  ]) {
    if (v) out.push(v.trim().toLowerCase());
  }
  return out;
}

// Group rows that are provably the same person because they share an actual
// address value across any of their email columns. This is the reliable,
// directory-free duplicate signal: the same string in two rows' columns is the
// same inbox, hence the same person. (The applicant⇄member case that shares NO
// address is handled separately, via the Dartmouth directory, in the script.)
//
// Union-find over the address→rows adjacency. Returns only the groups with more
// than one distinct row.
export function groupBySharedAddress<T extends IdentityEmails & { id: string }>(
  users: T[],
): T[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path-compress.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const u of users) parent.set(u.id, u.id);

  const addressToRow = new Map<string, string>();
  for (const u of users) {
    for (const addr of collectAddresses(u)) {
      const seen = addressToRow.get(addr);
      if (seen === undefined) addressToRow.set(addr, u.id);
      else union(seen, u.id);
    }
  }

  const byRoot = new Map<string, T[]>();
  for (const u of users) {
    const root = find(u.id);
    const bucket = byRoot.get(root) ?? [];
    bucket.push(u);
    byRoot.set(root, bucket);
  }

  return [...byRoot.values()].filter((g) => g.length > 1);
}

// A row is a husk when it carries no member work — only auth/session plumbing
// and at most a DALIMember marker. `businessRowCount` is the summed count of
// every content/relationship row owned by the user (applications, tasks, notes,
// assignments, reviews, …); if it is zero the row is safe to absorb and delete
// because nothing real gets re-parented. See HUSK_BUSINESS_RELATIONS in the
// script for the exact set counted.
export function isHusk(businessRowCount: number): boolean {
  return businessRowCount === 0;
}

// Decide which row of a same-person pair/group survives a merge.
//   - If exactly one row is a non-husk, it survives (absorb the husk into it).
//   - If ALL rows are husks, the oldest survives (arbitrary but stable).
//   - If TWO OR MORE are non-husks, there is real work on both sides: return
//     null → the script flags it for manual merge, never auto-merges.
export function chooseSurvivor<T extends { id: string; createdAt: Date }>(
  group: Array<{ row: T; husk: boolean }>,
): { survivor: T; duplicates: T[] } | null {
  const nonHusks = group.filter((g) => !g.husk);
  if (nonHusks.length > 1) return null; // both sides carry real work

  let survivorEntry: { row: T; husk: boolean };
  if (nonHusks.length === 1) {
    survivorEntry = nonHusks[0]!;
  } else {
    // All husks — keep the oldest.
    survivorEntry = [...group].sort(
      (a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime(),
    )[0]!;
  }
  const duplicates = group
    .filter((g) => g.row.id !== survivorEntry.row.id)
    .map((g) => g.row);
  if (duplicates.length === 0) return null;
  return { survivor: survivorEntry.row, duplicates };
}
