import { prisma } from "~/lib/db.server";
import { inReviewPipelineFilter, submittedDomainApplicationFilter } from "./application-pipeline-filter";
import { delibRounds, parseTimeline } from "./cycle-timeline";
import { derivedCycleStatus } from "./cycles";

// Blind review keeps a read of an application from being biased by who the
// applicant is, so it covers applications open through review. Any cycle can
// opt in (ApplicationCycle.anonymizeReview). It is a cycle-wide state that
// applies to every viewer alike, on every surface that goes through
// applicationBlindLabel/applicationBlindLabelsForCycle.

type BlindScope = "none" | "inReview" | "everyone";

// Review is over once the first delib round has closed in every domain with
// someone in review. A domain nobody is in review for can't hold it open.
async function firstDelibClosed(cycleId: string, timeline: unknown): Promise<boolean> {
  const firstRound = delibRounds(parseTimeline(timeline))[0];
  if (!firstRound) return false;
  const [inReview, closed] = await Promise.all([
    prisma.domainApplication.findMany({
      where: {
        selected: true,
        ...submittedDomainApplicationFilter,
        application: { applicationCycleId: cycleId, ...inReviewPipelineFilter },
      },
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    prisma.delibsSession.findMany({
      where: { applicationCycleId: cycleId, roundId: firstRound.id, status: "Closed" },
      select: { domainId: true },
    }),
  ]);
  const closedDomains = new Set(closed.map((s) => s.domainId));
  return inReview.every((da) => closedDomains.has(da.domainId));
}

async function cycleBlindScope(cycleId: string): Promise<BlindScope> {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: {
      anonymizeReview: true,
      closeDate: true,
      timeline: true,
      domains: { where: { isReady: true }, select: { closeDate: true } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
    },
  });
  if (!cycle.anonymizeReview) return "none";
  const status = derivedCycleStatus(cycle);
  if (status === "Completed") return "none";
  // A draft named while applications are open could still submit, and its
  // answers would then read as "Applicant N" to someone who saw the name.
  if (status !== "UnderReview") return "everyone";
  return (await firstDelibClosed(cycleId, cycle.timeline)) ? "none" : "inReview";
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
 * The blind labels for applications in one cycle: only the applications that
 * are blinded right now appear in the map.
 */
export async function applicationBlindLabelsForCycle(args: {
  cycleId: string;
  applicationIds: string[];
}): Promise<Map<string, string>> {
  const { cycleId, applicationIds } = args;
  const result = new Map<string, string>();
  if (applicationIds.length === 0) return result;

  const scope = await cycleBlindScope(cycleId);
  if (scope === "none") return result;

  const blindedIds =
    scope === "everyone"
      ? applicationIds
      : (
          await prisma.application.findMany({
            where: { id: { in: applicationIds }, ...inReviewPipelineFilter },
            select: { id: true },
          })
        ).map((a) => a.id);

  const labelMap = await anonLabelMapForCycle(cycleId);
  for (const id of blindedIds) result.set(id, labelMap.get(id) ?? anonLabel(1));
  return result;
}

/** The blind label for one application, or null when its applicant is named. */
export async function applicationBlindLabel(args: {
  cycleId: string;
  applicationId: string;
}): Promise<string | null> {
  const { cycleId, applicationId } = args;
  const labels = await applicationBlindLabelsForCycle({ cycleId, applicationIds: [applicationId] });
  return labels.get(applicationId) ?? null;
}
