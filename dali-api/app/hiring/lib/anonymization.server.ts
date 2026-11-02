import { prisma } from "~/lib/db.server";
import { inReviewPipelineFilter } from "./application-pipeline-filter";
import { delibRounds, parseTimeline } from "./cycle-timeline";
import { derivedCycleStatus } from "./cycles";
import { domainReviewStatus } from "./domain-windows";

// Blind review keeps a read of an application from being biased by who the
// applicant is. Any cycle can opt in (ApplicationCycle.anonymizeReview). Each
// domain lifts it on its own, for every viewer alike, on every surface that goes
// through these helpers. An applicant in two domains can read as named in one
// and "Applicant N" in the other, so the second domain's review stays blind.

type BlindScope = "none" | "inReview" | "everyone";
type BlindTarget = { key: string; applicationId: string; domainId: string | null };

async function domainsPastReview(cycleId: string, timeline: unknown): Promise<Set<string>> {
  const firstRound = delibRounds(parseTimeline(timeline))[0];
  const [invited, closed] = await Promise.all([
    prisma.domainApplication.findMany({
      where: {
        application: { applicationCycleId: cycleId },
        decisions: { some: { type: "InvitedToInterview", stage: "Released" } },
      },
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    firstRound
      ? prisma.delibsSession.findMany({
          where: { applicationCycleId: cycleId, roundId: firstRound.id, status: "Closed" },
          select: { domainId: true },
        })
      : [],
  ]);
  return new Set([...invited, ...closed].map((row) => row.domainId));
}

async function domainBlindScopes(
  cycleId: string,
): Promise<((domainId: string | null) => BlindScope) | null> {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: {
      anonymizeReview: true,
      closeDate: true,
      timeline: true,
      domains: { where: { isReady: true }, select: { domainId: true, closeDate: true } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
    },
  });
  if (!cycle.anonymizeReview) return null;
  const status = derivedCycleStatus(cycle);
  if (status === "Completed") return null;
  if (status !== "Open" && status !== "UnderReview") return () => "everyone";

  const pastReview = await domainsPastReview(cycleId, cycle.timeline);
  const windows = new Map(cycle.domains.map((d) => [d.domainId, d]));
  return (domainId) => {
    const open = domainId
      ? domainReviewStatus(status, windows.get(domainId) ?? { closeDate: null }, cycle) === "Open"
      : status === "Open";
    // A draft named while its window is open could still submit, and its
    // answers would then read as "Applicant N" to someone who saw the name.
    if (open) return "everyone";
    return domainId && pastReview.has(domainId) ? "none" : "inReview";
  };
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

async function blindLabelsFor(
  cycleId: string,
  loadTargets: () => Promise<BlindTarget[]>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const scopeFor = await domainBlindScopes(cycleId);
  if (!scopeFor) return result;

  const blindable = (await loadTargets()).filter((t) => scopeFor(t.domainId) !== "none");
  if (blindable.length === 0) return result;

  const toCheck = blindable.filter((t) => scopeFor(t.domainId) === "inReview");
  const inReview = new Set(
    toCheck.length === 0
      ? []
      : (
          await prisma.application.findMany({
            where: {
              id: { in: [...new Set(toCheck.map((t) => t.applicationId))] },
              ...inReviewPipelineFilter,
            },
            select: { id: true },
          })
        ).map((a) => a.id),
  );

  const labelMap = await anonLabelMapForCycle(cycleId);
  for (const t of blindable) {
    if (scopeFor(t.domainId) === "everyone" || inReview.has(t.applicationId)) {
      result.set(t.key, labelMap.get(t.applicationId) ?? anonLabel(1));
    }
  }
  return result;
}

/**
 * The blind labels for domain applications in one cycle, keyed by
 * domainApplicationId: only the rows blinded right now appear in the map.
 */
export async function domainApplicationBlindLabels(args: {
  cycleId: string;
  domainApplicationIds: string[];
}): Promise<Map<string, string>> {
  const { cycleId, domainApplicationIds } = args;
  if (domainApplicationIds.length === 0) return new Map();
  return blindLabelsFor(cycleId, async () => {
    const rows = await prisma.domainApplication.findMany({
      where: { id: { in: domainApplicationIds } },
      select: { id: true, domainId: true, applicationId: true },
    });
    return rows.map((r) => ({ key: r.id, applicationId: r.applicationId, domainId: r.domainId }));
  });
}

/** The blind label for one domain application, or null when its applicant is named there. */
export async function domainApplicationBlindLabel(args: {
  cycleId: string;
  domainApplicationId: string;
}): Promise<string | null> {
  const { cycleId, domainApplicationId } = args;
  const labels = await domainApplicationBlindLabels({
    cycleId,
    domainApplicationIds: [domainApplicationId],
  });
  return labels.get(domainApplicationId) ?? null;
}

/**
 * The blind label for a surface that shows a whole application rather than one
 * domain's row. Blinded while any of the application's selected domains is, or
 * only those in `domainIds` when the viewer's reach is narrower. An application
 * with no selected domains follows the cycle.
 */
export async function applicationBlindLabel(args: {
  cycleId: string;
  applicationId: string;
  domainIds?: string[];
}): Promise<string | null> {
  const { cycleId, applicationId, domainIds } = args;
  const labels = await blindLabelsFor(cycleId, async () => {
    const rows = await prisma.domainApplication.findMany({
      where: {
        applicationId,
        selected: true,
        ...(domainIds?.length ? { domainId: { in: domainIds } } : {}),
      },
      select: { id: true, domainId: true },
    });
    return rows.length > 0
      ? rows.map((r) => ({ key: r.id, applicationId, domainId: r.domainId }))
      : [{ key: applicationId, applicationId, domainId: null }];
  });
  return labels.values().next().value ?? null;
}
