import { prisma } from "~/lib/db";

// The type of hiring link a Form has to a cycle — either the general
// application form for the cycle itself, or a per-domain challenge form.
export type HiringFormLink = {
  linkType: "application" | "challenge";
  label: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  /** Set for challenge links — the CycleDomainForm row id, used to delete. */
  cycleDomainFormId?: string;
  /** Set for challenge links — the display name of the domain. */
  domainName?: string;
  /** True when the cycle is no longer a Draft — unlink is blocked. */
  locked: boolean;
  lockReason?: string;
};

// Derive the current status from a statusUpdates array ordered desc.
// Mirrors the pattern used across the hiring codebase:
//   prisma.applicationCycleStatusUpdate.findFirst({ orderBy: { createdAt: "desc" } })
// and the component hydration: `cycle.statusUpdates[0]?.newStatus ?? "Draft"`.
function resolveStatus(
  statusUpdates: { newStatus: string }[],
): string {
  return statusUpdates[0]?.newStatus ?? "Draft";
}

/**
 * Return every hiring cycle that currently references `formId`, split into
 * "application" (cycle.applicationFormId) and "challenge" (CycleDomainForm)
 * links. Used by the Form's Drive page to show where it is linked and offer
 * an Unlink action for Draft cycles.
 */
export async function loadFormHiringLinks(
  formId: string,
): Promise<HiringFormLink[]> {
  const [applicationCycles, domainForms] = await Promise.all([
    prisma.applicationCycle.findMany({
      where: { applicationFormId: formId },
      select: {
        id: true,
        name: true,
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.cycleDomainForm.findMany({
      where: { formId },
      select: {
        id: true,
        applicationCycle: {
          select: {
            id: true,
            name: true,
            statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
        domain: { select: { displayName: true } },
      },
    }),
  ]);

  const links: HiringFormLink[] = [];

  for (const cycle of applicationCycles) {
    const status = resolveStatus(cycle.statusUpdates);
    const locked = status !== "Draft";
    links.push({
      linkType: "application",
      label: `${cycle.name} — application form`,
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleStatus: status,
      locked,
      lockReason: locked ? "Cycle is no longer a draft" : undefined,
    });
  }

  for (const row of domainForms) {
    const status = resolveStatus(row.applicationCycle.statusUpdates);
    const locked = status !== "Draft";
    links.push({
      linkType: "challenge",
      label: `${row.applicationCycle.name} — ${row.domain.displayName} challenge`,
      cycleId: row.applicationCycle.id,
      cycleName: row.applicationCycle.name,
      cycleStatus: status,
      cycleDomainFormId: row.id,
      domainName: row.domain.displayName,
      locked,
      lockReason: locked ? "Cycle is no longer a draft" : undefined,
    });
  }

  return links;
}

/**
 * Unlink a hiring form from a cycle. Guards:
 * - The cycle must still be in Draft status.
 * - For challenge links: refuses if any DomainApplication has picked a
 *   version of this form (mirrors the `remove-challenge-form` intent in
 *   domain-lead.tsx).
 *
 * Returns `{ ok: true }` on success or `{ error: string }` on any guard
 * failure (never throws on the guard path).
 */
export async function unlinkHiringForm(
  input: {
    linkType: "application" | "challenge";
    cycleId?: string;
    cycleDomainFormId?: string;
  },
  _actorId: string,
): Promise<{ ok: true } | { error: string }> {
  if (input.linkType === "application") {
    const cycleId = input.cycleId;
    if (!cycleId) return { error: "cycleId is required for application unlink" };

    // Re-check status server-side before mutating.
    const latestUpdate =
      await prisma.applicationCycleStatusUpdate.findFirst({
        where: { applicationCycleId: cycleId },
        orderBy: { createdAt: "desc" },
      });
    const status = latestUpdate?.newStatus ?? "Draft";
    if (status !== "Draft") {
      return { error: "Cannot unlink — cycle is no longer a draft" };
    }

    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { applicationFormId: null },
    });
    return { ok: true };
  }

  // challenge
  const cdfId = input.cycleDomainFormId;
  if (!cdfId)
    return { error: "cycleDomainFormId is required for challenge unlink" };

  const cdf = await prisma.cycleDomainForm.findUnique({
    where: { id: cdfId },
  });
  if (!cdf) return { error: "Challenge form link not found" };

  // Re-check cycle status.
  const latestUpdate =
    await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cdf.applicationCycleId },
      orderBy: { createdAt: "desc" },
    });
  const status = latestUpdate?.newStatus ?? "Draft";
  if (status !== "Draft") {
    return { error: "Cannot unlink — cycle is no longer a draft" };
  }

  // Refuse if any DomainApplication has already used a version of this form
  // (mirrors the in-use guard in the `remove-challenge-form` intent).
  const inUse = await prisma.domainApplication.count({
    where: {
      challengeFormVersion: { formId: cdf.formId },
      application: { applicationCycleId: cdf.applicationCycleId },
    },
  });
  if (inUse > 0) {
    return {
      error:
        "Cannot unlink — this challenge form has already been answered by applicants",
    };
  }

  await prisma.cycleDomainForm.delete({ where: { id: cdfId } });
  return { ok: true };
}
