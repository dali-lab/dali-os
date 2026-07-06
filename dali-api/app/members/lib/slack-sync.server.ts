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

// A user whose Slack id we want to resolve for a channel invite. slackUserId may
// already be set (we use it as-is) or null (we look it up by email and persist).
export type SlackInviteCandidate = {
  id: string;
  slackUserId: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
};

// Resolve Slack ids for a set of users for a channel invite. For anyone already
// linked, use their stored slackUserId. For anyone unlinked, look them up by
// email (daliEmail → dartmouthEmail → personalEmail) and PERSIST the resolved id
// to their User row so it's there next time — fixing the common case where most
// members never visited Settings → Slack. Returns the deduped resolvable ids
// plus the ids of users we couldn't resolve (no Slack account for any email).
//
// Best-effort: a lookup failure or a unique collision leaves that user
// unresolved rather than throwing, so one bad email never blocks the invite.
export async function resolveSlackIdsForInvite(
  candidates: SlackInviteCandidate[],
): Promise<{ slackIds: string[]; unresolvedUserIds: string[] }> {
  // De-dupe by user id (Core/Admin/roster sets overlap).
  const byId = new Map<string, SlackInviteCandidate>();
  for (const c of candidates) if (!byId.has(c.id)) byId.set(c.id, c);

  const slackIds = new Set<string>();
  const unresolvedUserIds: string[] = [];

  for (const u of byId.values()) {
    if (u.slackUserId) {
      slackIds.add(u.slackUserId);
      continue;
    }
    const emails = [u.daliEmail, u.dartmouthEmail, u.personalEmail].filter(
      (e): e is string => !!e,
    );
    let resolved: string | null = null;
    for (const email of emails) {
      const id = await lookupSlackUserByEmail(email);
      if (id) {
        resolved = id;
        break;
      }
    }
    if (!resolved) {
      unresolvedUserIds.push(u.id);
      continue;
    }
    // Persist for next time; tolerate a unique collision (another user already
    // mapped to this id) by still using the id for THIS invite.
    try {
      await prisma.user.update({ where: { id: u.id }, data: { slackUserId: resolved } });
    } catch {
      // leave stored value as-is; we still invite by the resolved id below.
    }
    slackIds.add(resolved);
  }

  return { slackIds: [...slackIds], unresolvedUserIds };
}
