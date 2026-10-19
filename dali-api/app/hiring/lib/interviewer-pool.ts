// The second seat is cross-domain whenever the cycle has an interviewer from
// outside the applicant's domains. A cycle whose interviewers all share the
// applicant's domain (a single-domain program) pairs any two of them instead.
export function isSingleDomainPool(
  interviewers: Array<{ domainId: string }>,
  applicantDomainIds: string[],
): boolean {
  return interviewers.every((r) => applicantDomainIds.includes(r.domainId));
}

type PoolRow = { id: string; userId: string; domainId: string };

/** Who a seat on an interview can be handed to: the scheduler's own pairing
 *  rule, minus anyone already sitting on the interview. */
export function reassignCandidates<T extends PoolRow>(
  interviewers: T[],
  seat: { role: "InDomain" | "CrossDomain"; applicantDomainId: string; seatedUserIds: string[] },
): T[] {
  const inDomain = (r: PoolRow) => r.domainId === seat.applicantDomainId;
  const singleDomain = isSingleDomainPool(interviewers, [seat.applicantDomainId]);
  return interviewers.filter(
    (r) =>
      !seat.seatedUserIds.includes(r.userId) &&
      (seat.role === "InDomain" ? inDomain(r) : singleDomain || !inDomain(r)),
  );
}
