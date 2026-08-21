// Signatory roster for a signing binding: who has signed the in-force version
// (linkable to their completed copy) and — when the audience is enumerable —
// who hasn't. Shared by the per-agreement detail loader and the agreements
// console so the two never drift. The audience registry (audiences.ts) is the
// single source of "who is in this document's audience".

import { fullName } from "~/lib/display";
import type { SigningAudience } from "~/generated/prisma/enums";
import { AUDIENCE_RESOLVERS, type AudiencePerson } from "./audiences";

export interface BindingRoster {
  signed: { name: string; signatureId: string }[];
  // null when the audience can't be enumerated (Manual, HiringParticipants) —
  // callers then show the signed count only, with no "who hasn't signed" set.
  outstanding: string[] | null;
}

// The minimal binding shape the roster needs. Structural so both the detail
// loader's richly-typed binding and the console's selection satisfy it.
export interface RosterBinding {
  versionId: string;
  signatures: {
    id: string;
    roleKey: string;
    versionId: string;
    signerUserId: string;
    typedName: string | null;
    signer: { firstName: string | null; lastName: string | null } | null;
  }[];
}

// Split a binding's member signatures (on the in-force version) into the signed
// list and — given the resolved audience — the outstanding names.
export function computeRoster(
  audience: AudiencePerson[] | null,
  binding: RosterBinding,
): BindingRoster {
  const memberSigs = binding.signatures.filter(
    (s) => s.roleKey === "member" && s.versionId === binding.versionId,
  );
  const signedIds = new Set(memberSigs.map((s) => s.signerUserId));
  const signed = memberSigs
    .map((s) => ({ name: s.typedName || fullName(s.signer ?? {}) || "Unknown", signatureId: s.id }))
    .sort((a, z) => a.name.localeCompare(z.name));
  const outstanding = audience
    ? audience
        .filter((u) => !signedIds.has(u.id))
        .map((u) => `${u.firstName} ${u.lastName}`.trim())
        .sort()
    : null;
  return { signed, outstanding };
}

// Per-request memo of AUDIENCE_RESOLVERS[audience].listMembers({ termId }).
// Many bindings share an audience+term (e.g. every termly agreement resolves
// the same mentor/member roster for the current term), and each listMembers is
// a DB round-trip — so the console resolves each (audience, termId) once.
// Returns null for non-enumerable audiences without querying.
export function makeAudienceRosterCache() {
  const cache = new Map<string, Promise<AudiencePerson[] | null>>();
  return (
    audience: SigningAudience,
    termId: string | undefined,
  ): Promise<AudiencePerson[] | null> => {
    const resolver = AUDIENCE_RESOLVERS[audience];
    if (!resolver.enumerable) return Promise.resolve(null);
    const key = `${audience}:${termId ?? ""}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = resolver.listMembers({ termId });
      cache.set(key, hit);
    }
    return hit;
  };
}
