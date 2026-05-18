// Picker selection rules for the domain-lead dashboard. Pulled out of the
// route so it can be unit-tested without importing the route module (which
// transitively pulls in the prisma client). Keep this file dependency-free.
//
// Rules, in order:
//   1. Honor ?cycle=<id> when it matches one of the candidates.
//   2. Prefer a Standard cycle in Open/UnderReview — keeps the existing
//      single-cycle UX unchanged when a Standard cycle is the "main" one.
//   3. Any cycle in Open/UnderReview (InternToFull falls here).
//   4. Any Draft cycle.
//   5. Otherwise null (caller falls back to a "no active cycle" card).
export function selectActiveCycleForDomainLead<
  C extends { id: string; cycleType: string; statusUpdates: Array<{ newStatus: string }> },
>(candidates: C[], requestedId: string | null): C | null {
  if (requestedId) {
    const found = candidates.find((c) => c.id === requestedId);
    if (found) return found;
  }
  const isActive = (c: C) => {
    const s = c.statusUpdates[0]?.newStatus;
    return s === "Open" || s === "UnderReview";
  };
  const isDraft = (c: C) => c.statusUpdates[0]?.newStatus === "Draft";
  return (
    candidates.find((c) => c.cycleType === "Standard" && isActive(c)) ??
    candidates.find(isActive) ??
    candidates.find(isDraft) ??
    null
  );
}
