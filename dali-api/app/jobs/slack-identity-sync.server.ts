// Slack-identity sync job. Fills in User.slackUserId for members who joined the
// workspace after their provisioning step ran.
//
// Why it exists: slackUserId is only written on three event-driven paths —
// admin provisioning (`provisionMember`), profile-form submission, and the
// staffing-finalize invite resolver. Someone who accepts the Slack invite later
// (the common case) is never re-checked, so Hiring → Onboarding shows them as
// "Not joined" indefinitely and the Slack-DM nudge stays hidden for exactly the
// people who need it. This sweep re-asks Slack on a cadence.
//
// Scope: members and provisioned hires (a DALIMember row, or a daliEmail issued
// during onboarding) who have no slackUserId yet and at least one email to look
// up. Applicants and partner users are excluded — they aren't in the workspace,
// so calling Slack for them is pure API cost.
//
// Bounded + idempotent: one Slack call per candidate, capped at maxApiPerRun per
// tick; resolving is a no-op for anyone already linked (they're filtered out in
// the query), and a re-run after a crashed lease just re-tries the unresolved.
// Only fills nulls — it never clears a stored id, so a member who leaves the
// workspace keeps their stale mapping until someone clears it by hand.

import { prisma } from "~/lib/db";
import { syncSlackUserId } from "~/members/lib/slack-sync.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import type { JobContext, JobResult } from "~/jobs/registry";

export async function runSlackIdentitySync(ctx: JobContext): Promise<JobResult> {
  if (!slackConfigured()) {
    return { items: 0, note: "SLACK_BOT_TOKEN not set — skipped." };
  }
  const max = ctx.settings.maxApiPerRun ?? 200;

  const candidates = await prisma.user.findMany({
    where: {
      slackUserId: null,
      OR: [{ daliMember: { isNot: null } }, { daliEmail: { not: null } }],
      NOT: {
        daliEmail: null,
        dartmouthEmail: null,
        personalEmail: null,
      },
    },
    // Newest first: a hire mid-onboarding is the case the Onboarding page is
    // watching, and they're the ones most likely to have just joined.
    orderBy: { createdAt: "desc" },
    take: max,
    select: { id: true },
  });

  let resolved = 0;
  for (const c of candidates) {
    // Per-user isolation — one bad email or a transient Slack error must not
    // strand the rest of the sweep.
    try {
      const res = await syncSlackUserId(c.id);
      if (res.slackUserId) resolved += 1;
    } catch {
      // syncSlackUserId already swallows lookup failures; this guards the
      // unexpected (DB blip) so the tick still reports what it did resolve.
    }
  }

  return {
    items: resolved,
    note: `${candidates.length} checked, ${resolved} newly linked${
      candidates.length === max ? " (hit the per-run cap)" : ""
    }`,
  };
}
