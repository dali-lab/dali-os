import { prisma } from "~/lib/db";

// User @-handles (e.g. "spark" for Sophie Park). Seeded from first-initial +
// last-name, kept unique with a numeric suffix, and used to @-mention members
// in page-doc bodies and FAQ comments. Stored lowercase; the leading "@" is a
// display affordance only and never part of the stored value.

// Longest handle we'll store. Keeps mentions scannable and leaves room for a
// disambiguating suffix without unbounded growth.
const MAX_HANDLE_LENGTH = 30;

/** Normalize an arbitrary user-entered handle: lowercase, strip a leading "@",
 * and drop anything outside [a-z0-9_]. Returns "" when nothing survives. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_HANDLE_LENGTH);
}

/** Seed handle from a name: first initial + last name, lowercased and stripped.
 * "Sophie" + "Park" -> "spark". Falls back to the first name alone when there's
 * no usable last name, then to "member" when a name yields nothing. */
export function baseHandle(firstName: string, lastName: string): string {
  const first = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const last = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = last ? `${first.slice(0, 1)}${last}` : first;
  return base.slice(0, MAX_HANDLE_LENGTH) || "member";
}

/** Given a desired base, return the base itself if free, else the first
 * available "<base><n>" (base2, base3, …). `excludeUserId` lets a user keep
 * their own handle when re-saving. */
export async function ensureUniqueHandle(
  base: string,
  opts: { excludeUserId?: string } = {},
): Promise<string> {
  const normalized = normalizeHandle(base) || "member";
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? normalized : `${normalized}${suffix + 1}`;
    const existing = await prisma.user.findUnique({
      where: { handle: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === opts.excludeUserId) return candidate;
  }
}

/** Assign a derived, unique handle to a user if they don't have one yet.
 * Idempotent: a no-op once a handle is set, so it's safe to call on every
 * login/provision. */
export async function assignHandleIfMissing(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true, firstName: true, lastName: true },
  });
  if (!user || user.handle) return;
  const handle = await ensureUniqueHandle(baseHandle(user.firstName, user.lastName));
  // Race guard: two concurrent logins could both read a null handle and land
  // on the same candidate. The unique constraint makes the second write throw
  // P2002 — swallow it, the winner's handle is fine.
  try {
    await prisma.user.update({ where: { id: userId }, data: { handle } });
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("P2002"))) throw err;
  }
}
