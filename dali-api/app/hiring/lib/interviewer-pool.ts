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

/** Whether a roster member can take an interview at its time: free, busy on
 *  their calendar, no calendar or working hours to read, or on another
 *  interview inside the buffer. */
export type InterviewerAvailability = "free" | "busy" | "no-calendar" | "booked";

/** A lead may seat someone their calendar can't vouch for; a double booking stays blocked. */
export function canOverrideAvailability(availability: InterviewerAvailability): boolean {
  return availability === "busy" || availability === "no-calendar";
}

/** Who a seat on an interview can be handed to under the scheduler's own
 *  pairing rule, leaving out members already on the interview. */
export function seatEligible<T extends PoolRow>(
  interviewers: T[],
  seat: {
    role: "InDomain" | "CrossDomain";
    applicantDomainId: string;
    seatedUserIds: string[];
  },
): T[] {
  const inDomain = (r: PoolRow) => r.domainId === seat.applicantDomainId;
  const singleDomain = isSingleDomainPool(interviewers, [seat.applicantDomainId]);
  return interviewers.filter(
    (r) =>
      !seat.seatedUserIds.includes(r.userId) &&
      (seat.role === "InDomain" ? inDomain(r) : singleDomain || !inDomain(r)),
  );
}
