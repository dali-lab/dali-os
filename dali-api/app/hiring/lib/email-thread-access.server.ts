// Gate for opening the full Gmail thread behind an "Email with applications@"
// row: the thread must belong to the same application the viewer is looking
// at (via MailMessageIndex.linkedUserId), the viewer must have cycle access
// and have signed the cycle's confidentiality agreement, and — if the viewer
// is still blinded to this applicant on every surface they could have reached
// it from — the thread stays closed. Matches the Applications pages' blind
// review: Core/Admin/leads get no special exemption here any more, only a
// release (or, for an assigned reviewer, their own reviewerBlindLabel) lifts it.

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { applicationBlindLabel, reviewerBlindLabel } from "~/hiring/lib/anonymization.server";

export type ThreadAccessResult =
  | { ok: true; accountId: string; threadId: string; address: string }
  | { ok: false; status: 403 | 404 };

export async function canViewApplicantThread(args: {
  viewerId: string;
  applicationId: string;
  indexId: string;
  request: Request;
}): Promise<ThreadAccessResult> {
  const { viewerId, applicationId, indexId, request } = args;

  const [application, index] = await Promise.all([
    prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true, applicationCycleId: true, applicationCycle: { select: { anonymizeReview: true } } },
    }),
    prisma.mailMessageIndex.findUnique({
      where: { id: indexId },
      select: { accountId: true, threadId: true, linkedUserId: true, account: { select: { address: true } } },
    }),
  ]);
  if (!application || !index) return { ok: false, status: 404 };
  if (index.linkedUserId !== application.userId) return { ok: false, status: 403 };

  const cycleId = application.applicationCycleId;
  if (!(await hasCycleAccess(viewerId, cycleId))) return { ok: false, status: 403 };

  const confRedirect = await requirePageSignedOrRedirect(viewerId, cycleId, request);
  if (confRedirect) return { ok: false, status: 403 };

  const [reviewerLabel, applicationLabel] = await Promise.all([
    reviewerBlindLabel({
      reviewerId: viewerId,
      cycleId,
      applicationId: application.id,
      anonymizeReview: application.applicationCycle.anonymizeReview,
    }),
    applicationBlindLabel({
      cycleId,
      applicationId: application.id,
      anonymizeReview: application.applicationCycle.anonymizeReview,
    }),
  ]);
  const unblinded = reviewerLabel === null || applicationLabel === null;
  if (!unblinded) return { ok: false, status: 403 };

  return { ok: true, accountId: index.accountId, threadId: index.threadId, address: index.account.address };
}
