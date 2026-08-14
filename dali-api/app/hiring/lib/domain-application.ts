import { prisma } from "~/lib/db";

/**
 * Reconcile DomainApplication rows for an Application against a desired set of
 * domains.
 *
 * - Fellowship cycles call with just `domainIds` — DAs hold a direct
 *   domainId FK and no challenge version.
 * - Standard cycles call with `challengeVersionByDomain` populated — DAs are
 *   pinned to a per-domain ChallengeVersion; switching the CV wipes that
 *   domain's answers (the question set is different).
 *
 * Semantics in both modes:
 *   - Missing DA: create with selected=true (default).
 *   - Existing DA not in desired set: mark selected=false (answers preserved
 *     so the applicant can reselect without losing work).
 *   - Existing DA in desired set: ensure selected=true. For Standard, also
 *     swap CV + clear answers if the desired CV changed.
 */
export async function reconcileDomainApplications({
  applicationId,
  domainIds,
  challengeVersionByDomain,
}: {
  applicationId: string;
  domainIds: string[];
  challengeVersionByDomain?: Map<string, string>;
}): Promise<void> {
  const existing = await prisma.domainApplication.findMany({
    where: { applicationId },
    select: { id: true, domainId: true, selected: true, challengeVersionId: true },
  });
  const byDomain = new Map(
    existing.filter((da) => da.domainId).map((da) => [da.domainId!, da]),
  );

  for (const domainId of domainIds) {
    const desiredCv = challengeVersionByDomain?.get(domainId);
    const ex = byDomain.get(domainId);
    if (!ex) {
      await prisma.domainApplication.create({
        data: {
          applicationId,
          domainId,
          ...(desiredCv ? { challengeVersionId: desiredCv } : {}),
          answers: {},
        },
      });
      continue;
    }
    const updates: { selected?: boolean; challengeVersionId?: string; answers?: object } = {};
    if (!ex.selected) updates.selected = true;
    if (desiredCv && ex.challengeVersionId !== desiredCv) {
      updates.challengeVersionId = desiredCv;
      updates.answers = {};
    }
    if (Object.keys(updates).length > 0) {
      await prisma.domainApplication.update({
        where: { id: ex.id },
        data: updates,
      });
    }
  }

  const toDeselect = existing
    .filter((da) => da.domainId && !domainIds.includes(da.domainId) && da.selected)
    .map((da) => da.id);
  if (toDeselect.length > 0) {
    await prisma.domainApplication.updateMany({
      where: { id: { in: toDeselect } },
      data: { selected: false },
    });
  }
}
