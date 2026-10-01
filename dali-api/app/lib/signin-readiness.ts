// Can this row reach its account? Pure classification, no Prisma, no network,
// so the rule that decides who is locked out is testable rather than buried in
// a script.
//
// Sign-in reduces to two facts:
//
//   1. BetterAuth finds an account only by User.email. Null there means no code
//      can be sent, however many aliases the row carries — resolution returns
//      that column's value, so there is nothing to return.
//
//   2. The address typed has to be one we hold, and the netid form
//      (f00xxxx@dartmouth.edu) does not count. CAS synthesized it, it delivers,
//      and nobody knows it. A row holding only that is unreachable in practice
//      while looking perfectly healthy in the database — which is exactly why
//      the mini-series lockout went unnoticed: everything we SENT arrived.

export type ReadinessInput = {
  netId: string | null;
  email: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  /** Addresses already in UserEmail for this row, normalized. */
  aliases: string[];
};

export type Readiness = {
  verdict: "ok" | "locked-out" | "no-canonical" | "no-address";
  /** Every address on the row, normalized and deduped. */
  all: string[];
  /** Those a person would actually type — everything except the netid form. */
  human: string[];
  /** Addresses held on User columns but missing from UserEmail. */
  missingAliases: string[];
};

function norm(address: string | null): string | null {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** The address CAS invented from a netID: deliverable, but never typed. */
export function synthesizedAddress(netId: string | null): string | null {
  const id = norm(netId);
  return id ? `${id}@dartmouth.edu` : null;
}

export function classifySignInReadiness(input: ReadinessInput): Readiness {
  const synth = synthesizedAddress(input.netId);
  const columns = [
    input.email,
    input.daliEmail,
    input.dartmouthEmail,
    input.personalEmail,
  ]
    .map(norm)
    .filter((a): a is string => a !== null);

  const aliases = input.aliases.map(norm).filter((a): a is string => a !== null);
  const all = [...new Set([...columns, ...aliases])];
  const human = all.filter((a) => a !== synth);

  const held = new Set(aliases);
  const missingAliases = [...new Set(columns)].filter((a) => !held.has(a));

  // Order matters: a row with no address at all is a different problem from one
  // whose addresses exist but cannot be turned into a login identifier.
  const verdict: Readiness["verdict"] =
    all.length === 0
      ? "no-address"
      : norm(input.email) === null
        ? "no-canonical"
        : human.length === 0
          ? "locked-out"
          : "ok";

  return { verdict, all, human, missingAliases };
}

/**
 * The canonical address a row should carry, or null to leave it as it is.
 *
 * @dali wins over everything. A member's lab address is what the app displays,
 * what they identify with, and what resolveCanonicalEmail already picks first,
 * so a Dartmouth address must never displace it — and a row that an earlier
 * repair demoted gets put back rather than left. Otherwise promote only over an
 * address nobody can type: the synthesized netid form, or nothing at all.
 *
 * `candidate` is the real Dartmouth address just learned for this person.
 */
export function preferredCanonicalEmail(input: {
  netId: string | null;
  email: string | null;
  daliEmail: string | null;
  candidate: string | null;
}): string | null {
  const dali = normalize(input.daliEmail);
  const current = normalize(input.email);

  if (dali) return current === dali ? null : dali;

  const candidate = normalize(input.candidate);
  if (candidate === null || current === candidate) return null;

  // An address a person can actually type is already good enough; only the
  // synthesized form (or nothing) is worth replacing.
  const synth = synthesizedAddress(input.netId);
  if (current !== null && current !== synth) return null;

  return candidate;
}

function normalize(address: string | null): string | null {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
