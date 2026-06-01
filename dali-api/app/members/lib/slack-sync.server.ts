import { prisma } from "~/lib/db";
import { lookupSlackUserByEmail } from "~/slack/lib/slack-client";

// Resolve and persist a member's Slack user id from their email, so later
// channel invites (staffing finalize) can add them by id. Tries their DALI
// email first, then Dartmouth/personal. Best-effort + idempotent: leaves
// slackUserId untouched if no Slack account matches or it's already set.
//
// Called as an onboarding/provisioning step. The lookup needs the bot token's
// users:read.email scope; without it (or no Slack account) we simply no-op.
export async function syncSlackUserId(
  userId: string,
): Promise<{ status: "ok" | "skipped"; slackUserId: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      slackUserId: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
    },
  });
  if (!user) return { status: "skipped", slackUserId: null };
  if (user.slackUserId) {
    return { status: "ok", slackUserId: user.slackUserId };
  }

  const emails = [user.daliEmail, user.dartmouthEmail, user.personalEmail].filter(
    (e): e is string => !!e,
  );
  for (const email of emails) {
    const slackId = await lookupSlackUserByEmail(email);
    if (slackId) {
      try {
        await prisma.user.update({ where: { id: userId }, data: { slackUserId: slackId } });
      } catch {
        // Unique collision (another user already mapped to this slack id) —
        // leave as-is rather than failing the onboarding step.
        return { status: "skipped", slackUserId: null };
      }
      return { status: "ok", slackUserId: slackId };
    }
  }
  return { status: "skipped", slackUserId: null };
}
