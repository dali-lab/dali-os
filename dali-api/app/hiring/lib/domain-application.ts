import { prisma } from "~/lib/db";

/**
 * Reconcile DomainApplication rows for an Application against a desired set of
 * domains.
 *
 * - Internal (Fellowship/Core) cycles call with just `domainIds` — DAs hold a
 *   direct domainId FK and no per-domain challenge.
 * - Standard cycles call with `challengeFormVersionByDomain` populated — DAs are
 *   pinned to the picked per-domain challenge Form's FormVersion; switching the
 *   pick wipes that domain's answers (the question set is different).
 *
 * Semantics in both modes:
 *   - Missing DA: create with selected=true (default).
 *   - Existing DA not in desired set: mark selected=false (answers preserved so
 *     the applicant can reselect without losing work).
 *   - Existing DA in desired set: ensure selected=true. For Standard, also swap
 *     the pinned challenge Form version + clear answers if the pick changed.
 */
export async function reconcileDomainApplications({
  applicationId,
  domainIds,
  challengeFormVersionByDomain,
}: {
  applicationId: string;
  domainIds: string[];
  // Standard cycles: domain → picked challenge FormVersion id.
  challengeFormVersionByDomain?: Map<string, string>;
}): Promise<void> {
  const existing = await prisma.domainApplication.findMany({
    where: { applicationId },
    select: { id: true, domainId: true, selected: true, challengeFormVersionId: true },
  });
  const byDomain = new Map(
    existing.filter((da) => da.domainId).map((da) => [da.domainId!, da]),
  );

  for (const domainId of domainIds) {
    const desiredForm = challengeFormVersionByDomain?.get(domainId);
    const ex = byDomain.get(domainId);
    if (!ex) {
      await prisma.domainApplication.create({
        data: {
          applicationId,
          domainId,
          ...(desiredForm ? { challengeFormVersionId: desiredForm } : {}),
          answers: {},
        },
      });
      continue;
    }
    const updates: { selected?: boolean; challengeFormVersionId?: string; answers?: object } = {};
    if (!ex.selected) updates.selected = true;
    if (desiredForm && ex.challengeFormVersionId !== desiredForm) {
      updates.challengeFormVersionId = desiredForm;
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
