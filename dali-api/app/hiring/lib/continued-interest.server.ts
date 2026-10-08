// Continued interest: a returning waitlister reuses the application they were
// waitlisted on instead of applying from scratch, and answers the cycle's short
// continued interest form on top of it.
//
// Reuse is copy-and-freeze, not a live reference. The new DomainApplication
// takes the waitlisted one's challenge answers and pinned form version, and the
// new Application takes its general answers and pinned form version, so review,
// delibs and interviews read it like any other application. The link
// (`continuedFromId`) is what marks those answers as frozen and hangs the
// continued interest form off the DA.
//
// Students cycles only, and only on cycles that bind a continued interest form.

import { prisma } from "~/lib/db";
import { Prisma } from "~/generated/prisma/client";
import type { Question } from "~/types";
import { presignAnswers } from "~/hiring/lib/presign";

export type WaitlistedApplicationOption = {
  domainApplicationId: string;
  domainId: string;
  domainName: string;
  cycleName: string;
  waitlistedAt: string;
};

const RELEASED_WAITLISTED = { stage: "Released", type: "Waitlisted" } as const;

/**
 * The applicant's domain applications that were ever waitlisted in another
 * Students cycle, for domains this cycle is hiring. "Ever" is deliberate:
 * being removed from the waitlist is exactly when Core invites someone to
 * reapply this way.
 */
export async function listWaitlistedApplications(
  userId: string,
  cycleId: string,
): Promise<WaitlistedApplicationOption[]> {
  const rows = await prisma.domainApplication.findMany({
    where: {
      application: {
        userId,
        applicationCycleId: { not: cycleId },
        applicationCycle: { applicants: "Students" },
      },
      domain: { applicationCycles: { some: { applicationCycleId: cycleId } } },
      decisions: { some: RELEASED_WAITLISTED },
    },
    select: {
      id: true,
      domainId: true,
      domain: { select: { name: true } },
      application: { select: { applicationCycle: { select: { name: true } } } },
      decisions: {
        where: RELEASED_WAITLISTED,
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return rows
    .map((da) => ({
      domainApplicationId: da.id,
      domainId: da.domainId,
      domainName: da.domain.name,
      cycleName: da.application.applicationCycle.name,
      waitlistedAt: da.decisions[0]!.createdAt.toISOString(),
    }))
    .sort((a, b) => b.waitlistedAt.localeCompare(a.waitlistedAt));
}

async function latestFormVersionId(formId: string): Promise<string | null> {
  const version = await prisma.formVersion.findFirst({
    where: { formId },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return version?.id ?? null;
}

/**
 * Point the applicant's application for `cycle` at one of their waitlisted
 * domain applications, creating the draft if there isn't one yet. Overwrites
 * the draft's general answers and that domain's answers with the waitlisted
 * ones.
 */
export async function reuseWaitlistedApplication(args: {
  userId: string;
  cycle: { id: string; continuedInterestFormId: string | null };
  waitlistedDomainApplicationId: string;
  /** Recorded only when this call creates the draft. */
  startTermId: string | null;
}): Promise<"not-offered" | "not-found" | null> {
  const { userId, cycle, waitlistedDomainApplicationId, startTermId } = args;
  if (!cycle.continuedInterestFormId) return "not-offered";
  const continuedInterestFormVersionId = await latestFormVersionId(cycle.continuedInterestFormId);
  if (!continuedInterestFormVersionId) return "not-offered";

  const offered = await listWaitlistedApplications(userId, cycle.id);
  if (!offered.some((o) => o.domainApplicationId === waitlistedDomainApplicationId)) {
    return "not-found";
  }
  const source = await prisma.domainApplication.findUniqueOrThrow({
    where: { id: waitlistedDomainApplicationId },
    select: {
      domainId: true,
      answers: true,
      challengeFormVersionId: true,
      application: { select: { answers: true, applicationFormVersionId: true } },
    },
  });
  const general = {
    answers: source.application.answers as Prisma.InputJsonValue,
    applicationFormVersionId: source.application.applicationFormVersionId,
  };

  await prisma.$transaction(async (tx) => {
    const application = await tx.application.upsert({
      where: { userId_applicationCycleId: { userId, applicationCycleId: cycle.id } },
      update: general,
      create: {
        userId,
        applicationCycleId: cycle.id,
        startTermId,
        ...general,
        statusUpdates: { create: { newStatus: "Draft", userId } },
      },
      select: { id: true },
    });
    const existing = await tx.domainApplication.findFirst({
      where: { applicationId: application.id, domainId: source.domainId },
      select: { id: true, continuedInterestFormVersionId: true },
    });
    const reuse = {
      selected: true,
      answers: source.answers as Prisma.InputJsonValue,
      challengeFormVersionId: source.challengeFormVersionId,
      continuedFromId: waitlistedDomainApplicationId,
      continuedInterestFormVersionId,
    };
    if (!existing) {
      await tx.domainApplication.create({
        data: { ...reuse, applicationId: application.id, domainId: source.domainId },
      });
    } else {
      await tx.domainApplication.update({
        where: { id: existing.id },
        data: {
          ...reuse,
          // Answers to another version of the form don't carry over.
          ...(existing.continuedInterestFormVersionId !== continuedInterestFormVersionId && {
            continuedInterestAnswers: Prisma.DbNull,
          }),
        },
      });
    }
  });
  return null;
}

/**
 * Undo `reuseWaitlistedApplication` for one domain: the DA goes back to a blank
 * answer to one of this cycle's own challenges. Once no domain reuses a
 * waitlisted application, the general form goes back to the cycle's own too.
 */
export async function stopUsingWaitlistedApplication(args: {
  applicationId: string;
  domainId: string;
  cycle: { id: string; hasChallenges: boolean; applicationFormId: string | null };
}): Promise<void> {
  const { applicationId, domainId, cycle } = args;
  const da = await prisma.domainApplication.findFirst({
    where: { applicationId, domainId, continuedFromId: { not: null } },
    select: { id: true },
  });
  if (!da) return;

  const challenge = cycle.hasChallenges
    ? await prisma.cycleDomainForm.findFirst({
        where: { applicationCycleId: cycle.id, domainId },
        orderBy: { createdAt: "asc" },
        select: { formId: true },
      })
    : null;
  const challengeFormVersionId = challenge ? await latestFormVersionId(challenge.formId) : null;
  const applicationFormVersionId = cycle.applicationFormId
    ? await latestFormVersionId(cycle.applicationFormId)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.domainApplication.update({
      where: { id: da.id },
      data: {
        answers: {},
        challengeFormVersionId,
        continuedFromId: null,
        continuedInterestFormVersionId: null,
        continuedInterestAnswers: Prisma.DbNull,
      },
    });
    const stillContinued = await tx.domainApplication.count({
      where: { applicationId, continuedFromId: { not: null } },
    });
    if (stillContinued === 0) {
      await tx.application.update({
        where: { id: applicationId },
        data: { answers: {}, applicationFormVersionId },
      });
    }
  });
}

export type ContinuedInterestView = {
  fromCycleName: string;
  questions: Question[];
  answers: Record<string, string>;
};

/**
 * A DA's continued interest form and answers for the reviewer-side viewers
 * (file answers presigned), or null when the DA isn't a reused application.
 */
export async function loadContinuedInterestView(da: {
  continuedFromId: string | null;
  continuedInterestFormVersionId: string | null;
  continuedInterestAnswers: unknown;
}): Promise<ContinuedInterestView | null> {
  if (!da.continuedFromId) return null;
  const [source, version] = await Promise.all([
    prisma.domainApplication.findUnique({
      where: { id: da.continuedFromId },
      select: { application: { select: { applicationCycle: { select: { name: true } } } } },
    }),
    da.continuedInterestFormVersionId
      ? prisma.formVersion.findUnique({
          where: { id: da.continuedInterestFormVersionId },
          select: { questions: true },
        })
      : null,
  ]);
  const questions = (version?.questions as unknown as Question[]) ?? [];
  return {
    fromCycleName: source?.application.applicationCycle.name ?? "an earlier cycle",
    questions,
    answers: await presignAnswers(
      questions,
      (da.continuedInterestAnswers ?? {}) as Record<string, string>,
    ),
  };
}
