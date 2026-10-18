// Partner meeting request expiry: a partner's scheduling request that Core
// never acted on, past its requested start time, is no longer actionable —
// mark it Expired and log it to the timeline. No notify() here; nothing
// actionable is left for anyone to respond to.

import { prisma } from "~/lib/db";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const CAP = 200;

export async function runPartnerRequestExpiry({ now }: JobContext): Promise<JobResult> {
  const expiring = await prisma.partnerMeetingRequest.findMany({
    where: { status: "Pending", startTime: { lt: now } },
    select: { id: true, applicationId: true, contactId: true },
    take: CAP,
  });

  let expired = 0;
  for (const request of expiring) {
    await prisma.partnerMeetingRequest.update({
      where: { id: request.id },
      data: { status: "Expired" },
    });
    await logPartnerActivity(prisma, {
      applicationId: request.applicationId,
      contactId: request.contactId,
      type: "MeetingRequestDeclined",
      body: "Request expired",
      metadata: { requestId: request.id, expired: true },
    });
    expired += 1;
  }

  return { items: expired };
}
