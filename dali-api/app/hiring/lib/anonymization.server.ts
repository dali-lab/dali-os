import { prisma } from "~/lib/db";

// Blind review hides applicant identity during the reading + Initial-delibs
// stage of a hiring cycle, so a read of an application isn't biased by who
// the applicant is. It lifts per applicant the moment a decision is Released
// for them. Any cycle can opt in (ApplicationCycle.anonymizeReview). Core and
// leads are no longer exempt everywhere: the applications list
// (applications.tsx) and the two read-only applicant-detail pages
// (applications.$domainApplicationId.tsx, domain-lead.application.$id.tsx)
// blind everyone alike via applicationBlindLabel/applicationBlindLabelsForCycle
// below. Only the lead cycle-management page, delibs, and interviews surfaces
// stay untouched by this — a lead can still turn blind review off per cycle
// there if they need names. reviewerBlindLabel (scoped to one reviewer's
// assigned domains) remains the predicate for the reviewer review surface.

/**
 * The blind-review predicate. `hasReleasedDecision` is true when a Decision at
 * stage "Released" exists for the domain application being viewed (the applicant
 * has moved past review).
 */
export function isApplicantBlinded(
  cycle: { anonymizeReview: boolean },
  hasReleasedDecision: boolean,
): boolean {
  return cycle.anonymizeReview && !hasReleasedDecision;
}

/** Stable pseudonym for a 1-indexed applicant sequence. */
export function anonLabel(seq: number): string {
  return `Applicant ${seq}`;
}

/**
 * Map every application in a cycle to a stable "Applicant N" label, ordered by
 * [createdAt asc, id asc]. Stable across surfaces and across reviewers; a late
 * submission appends a higher number without renumbering earlier applicants.
 * Keyed by applicationId so a multi-domain applicant reads as the same label in
 * every domain's delibs.
 */
export async function anonLabelMapForCycle(
  cycleId: string,
): Promise<Map<string, string>> {
  const apps = await prisma.application.findMany({
    where: { applicationCycleId: cycleId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const map = new Map<string, string>();
  apps.forEach((a, i) => map.set(a.id, anonLabel(i + 1)));
  return map;
}

/**
 * Of the given domain-application ids, the subset that have a Released decision
 * (i.e. have moved past review). One batched query; empty input short-circuits.
 */
export async function releasedDaIds(daIds: string[]): Promise<Set<string>> {
  if (daIds.length === 0) return new Set();
  const rows = await prisma.decision.findMany({
    where: { stage: "Released", domainApplicationId: { in: daIds } },
    select: { domainApplicationId: true },
  });
  return new Set(
    rows
      .map((r) => r.domainApplicationId)
      .filter((id): id is string => id != null),
  );
}

// Structured identity fields stripped when blinding. firstName carries the
// label and lastName is emptied so the ubiquitous `${firstName} ${lastName}`
// render produces exactly "Applicant N"; every other identifying field is nulled
// so it never reaches the client payload. The opaque `id` is intentionally kept
// (React keys, engagement lookups already done server-side).
const BLINDED_IDENTITY_FIELDS = [
  "photoUrl",
  "daliEmail",
  "dartmouthEmail",
  "personalEmail",
  "netId",
  "nameOnFile",
  "ethnicity",
  "pronouns",
  "phoneNumber",
  "birthday",
  "classYear",
  "handle",
  "slackUserId",
  "githubUsername",
] as const;

/**
 * Return a copy of an applicant user with identity replaced by the blind-review
 * pseudonym. Safe to call on any user shape — fields absent from the selection
 * are simply added as null.
 */
export function blindUser<T extends { firstName?: unknown; lastName?: unknown }>(
  user: T,
  label: string,
): T {
  const blinded: Record<string, unknown> = { ...user, firstName: label, lastName: "" };
  for (const field of BLINDED_IDENTITY_FIELDS) {
    if (field in blinded) blinded[field] = null;
  }
  return blinded as T;
}

/**
 * The reviewer-page blind-review predicate as a reusable label lookup: null
 * when this reviewer should see the applicant's real identity on this
 * application, otherwise the stable "Applicant N" pseudonym. Scopes the
 * released-decision check to the domain applications this reviewer is
 * actually assigned to, same as reviewer.application.$id's loader.
 */
export async function reviewerBlindLabel(args: {
  reviewerId: string;
  cycleId: string;
  applicationId: string;
  anonymizeReview: boolean;
}): Promise<string | null> {
  const { reviewerId, cycleId, applicationId, anonymizeReview } = args;
  if (!anonymizeReview) return null;

  const cycleReviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: cycleId, userId: reviewerId },
    select: { domainId: true },
  });
  const domainIds = cycleReviewers.map((cr) => cr.domainId);

  const domainApplications = await prisma.domainApplication.findMany({
    where: { applicationId, selected: true, domainId: { in: domainIds } },
    select: { id: true },
  });
  const daIds = domainApplications.map((da) => da.id);

  const released = await releasedDaIds(daIds);
  const blinded = daIds.length === 0 || daIds.some((id) => !released.has(id));
  if (!blinded) return null;

  const labelMap = await anonLabelMapForCycle(cycleId);
  return labelMap.get(applicationId) ?? anonLabel(1);
}

/**
 * The applications-list / applicant-detail blind-review predicate: unlike
 * reviewerBlindLabel (scoped to one reviewer's assigned domains), this checks
 * ALL of the application's selected DomainApplications — so it blinds the
 * same way for every viewer (Core, Admin, leads, reviewers alike) who lands on
 * `applications.$domainApplicationId` or `domain-lead.application.$id`.
 */
export async function applicationBlindLabel(args: {
  cycleId: string;
  applicationId: string;
  anonymizeReview: boolean;
}): Promise<string | null> {
  const { cycleId, applicationId, anonymizeReview } = args;
  if (!anonymizeReview) return null;

  const domainApplications = await prisma.domainApplication.findMany({
    where: { applicationId, selected: true },
    select: { id: true },
  });
  const daIds = domainApplications.map((da) => da.id);

  const released = await releasedDaIds(daIds);
  const blinded = daIds.length === 0 || daIds.some((id) => !released.has(id));
  if (!blinded) return null;

  const labelMap = await anonLabelMapForCycle(cycleId);
  return labelMap.get(applicationId) ?? anonLabel(1);
}

/**
 * Batched applicationBlindLabel for a page that renders many applications at
 * once (the applications list): one releasedDaIds call plus one
 * anonLabelMapForCycle call instead of one pair per row. Callers supply each
 * application's FULL set of selected DomainApplication ids (not just the ones
 * visible to the current viewer) — blinding is a whole-application state, so
 * a domain this viewer can't see still has to count toward it. Returns only
 * the ids that are blinded.
 */
export async function applicationBlindLabelsForCycle(args: {
  cycleId: string;
  anonymizeReview: boolean;
  applications: { id: string; daIds: string[] }[];
}): Promise<Map<string, string>> {
  const { cycleId, anonymizeReview, applications } = args;
  const result = new Map<string, string>();
  if (!anonymizeReview) return result;

  const released = await releasedDaIds(applications.flatMap((a) => a.daIds));
  const labelMap = await anonLabelMapForCycle(cycleId);

  for (const a of applications) {
    const blinded = a.daIds.length === 0 || a.daIds.some((id) => !released.has(id));
    if (blinded) result.set(a.id, labelMap.get(a.id) ?? anonLabel(1));
  }
  return result;
}
