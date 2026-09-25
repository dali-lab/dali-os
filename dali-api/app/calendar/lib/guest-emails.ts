// Guests invited by address rather than by DALI profile. Client-safe: the guest
// picker uses it to decide when a typed query can be invited, and the server
// uses it to clean what the picker sent.

export const MAX_GUEST_EMAILS = 50;

// Deliberately loose (something@domain.tld) — Google is the real validator, and
// a group or resource calendar address looks like any other address.
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isGuestEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// Lowercased, deduped, invalid entries dropped, and minus any address in
// `exclude` (members already on the invite, so nobody is added twice).
export function normalizeGuestEmails(emails: readonly string[], exclude: readonly string[] = []): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const out = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (isGuestEmail(email) && !skip.has(email)) out.add(email);
  }
  return [...out].slice(0, MAX_GUEST_EMAILS);
}
