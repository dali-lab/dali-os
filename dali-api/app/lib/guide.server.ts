// Server side of the interactive guide: evaluate the account requirements a
// gated step depends on, and read/write per-step progress.
//
// Requirements are derived from the account, never stored — a member who
// uploads a photo has satisfied the photo step whether or not the guide was
// open at the time. That also means the Help page's ledger is always honest
// about the current state instead of replaying what someone once clicked.

import { prisma } from "~/lib/db";
import {
  GUIDE_STEP_IDS,
  guideProgress,
  type GuideProgress,
  type GuideRequirements,
} from "~/lib/guide";

export type GuideState = {
  requirements: GuideRequirements;
  clearedIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  progress: GuideProgress;
};

/** The account signals every requirement is derived from. */
export type GuideAccountSignals = {
  photoUrl: string | null;
  timeZone: string | null;
  calendarLinks: { id: string }[];
};

/**
 * Derive requirements from the row the app shell already loads on every
 * navigation — no extra query for the common case.
 */
export function guideRequirements(
  me: GuideAccountSignals | null,
): GuideRequirements {
  return {
    photo: Boolean(me?.photoUrl),
    timezone: Boolean(me?.timeZone),
    calendarLink: (me?.calendarLinks.length ?? 0) > 0,
  };
}

export async function loadGuideState(userId: string): Promise<GuideState> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      photoUrl: true,
      timeZone: true,
      calendarLinks: {
        where: { provider: "Google", enabled: true },
        select: { id: true },
        take: 1,
      },
      daliMember: {
        select: {
          guideStepIds: true,
          guideStartedAt: true,
          tourCompletedAt: true,
        },
      },
    },
  });

  const requirements = guideRequirements(me);
  const clearedIds = me?.daliMember?.guideStepIds ?? [];
  return {
    requirements,
    clearedIds,
    startedAt: me?.daliMember?.guideStartedAt?.toISOString() ?? null,
    completedAt: me?.daliMember?.tourCompletedAt?.toISOString() ?? null,
    progress: guideProgress(clearedIds, requirements),
  };
}

/**
 * Record a cleared step. Idempotent and additive — the guide is resumable, so
 * dismissing it must never discard what the member already did. Unknown ids
 * are dropped rather than stored, which keeps the column clean when a step is
 * removed from the registry.
 */
export async function recordGuideStep(userId: string, stepId: string) {
  if (!GUIDE_STEP_IDS.includes(stepId)) return;
  const member = await prisma.dALIMember.findUnique({
    where: { userId },
    select: { id: true, guideStepIds: true, guideStartedAt: true },
  });
  if (!member) return;
  if (member.guideStepIds.includes(stepId)) return;
  await prisma.dALIMember.update({
    where: { id: member.id },
    data: {
      guideStepIds: { push: stepId },
      ...(member.guideStartedAt ? {} : { guideStartedAt: new Date() }),
    },
  });
}

/** Mark the guide started without clearing anything (member hit "Show me around"). */
export async function markGuideStarted(userId: string) {
  await prisma.dALIMember.updateMany({
    where: { userId, guideStartedAt: null },
    data: { guideStartedAt: new Date() },
  });
}

/**
 * Stop auto-showing the guide. Progress is deliberately left intact so the
 * member can pick up where they left off from the Help page.
 */
export async function dismissGuide(userId: string) {
  await prisma.dALIMember.updateMany({
    where: { userId, tourCompletedAt: null },
    data: { tourCompletedAt: new Date() },
  });
}

/** Start over from step one, e.g. the Help page's "Restart" control. */
export async function resetGuide(userId: string) {
  await prisma.dALIMember.updateMany({
    where: { userId },
    data: { guideStepIds: [], guideStartedAt: new Date(), tourCompletedAt: null },
  });
}
