// Fire-and-forget admin notifications for pay-affecting promotions (issue #1001):
// a domain pay-level advancement (P1→P2→P3), becoming an Instructor, or joining
// Core. Only *advancements / new grants* notify — a new hire's initial P1 and
// role removals are intentionally silent (enforced at the hooked write sites).
//
// Recipients are all admins (AdminMembership rows ∪ ADMIN_USER_IDS env), minus
// the actor who made the change. Dispatch goes through notify()/the event
// registry, so admins can tune channels in Settings → Notifications like any
// other event. Callers wrap these in `void ...catch()` so delivery never fails
// the underlying mutation.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { getAdminUserIdsFromEnv } from "~/lib/roles";
import type { Level } from "~/lib/level";

const LEVEL_RANK: Record<Level, number> = { P1: 1, P2: 2, P3: 3 };

// True only for a genuine upward move from a known prior level. A brand-new
// eligibility row (from === null) is an initial grant, not an advancement, and
// stays silent — that's the "not the initial P1 on hire" rule.
export function isLevelAdvance(from: Level | null, to: Level): boolean {
  return from !== null && LEVEL_RANK[to] > LEVEL_RANK[from];
}

async function adminRecipientIds(excludeUserId?: string): Promise<string[]> {
  const rows = await prisma.adminMembership.findMany({ select: { userId: true } });
  const ids = new Set(rows.map((r) => r.userId));
  for (const id of getAdminUserIdsFromEnv()) ids.add(id);
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

// Dispatch one admin notification about `userId`'s promotion.
export async function notifyAdminsOfPromotion(args: {
  userId: string;
  actorId: string;
  summary: string; // predicate, e.g. "was promoted to P3 in Design"
}): Promise<void> {
  const [member, recipients] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.userId },
      select: { firstName: true, lastName: true },
    }),
    adminRecipientIds(args.actorId),
  ]);
  if (recipients.length === 0) return;
  const name =
    [member?.firstName, member?.lastName].filter(Boolean).join(" ").trim() || "A member";
  await notify({
    eventType: "member.promotion",
    createdByUserId: args.actorId,
    message: {
      title: `${name} ${args.summary}`,
      link: `/members/${args.userId}`,
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}

// Convenience for the pay-level write sites: guard on a real advance, resolve
// the domain's display name, then notify. No-op when it isn't an advancement.
export async function notifyAdminsOfLevelAdvance(args: {
  userId: string;
  domainId: string;
  from: Level | null;
  to: Level;
  actorId: string;
}): Promise<void> {
  if (!isLevelAdvance(args.from, args.to)) return;
  const domain = await prisma.domain.findUnique({
    where: { id: args.domainId },
    select: { displayName: true },
  });
  await notifyAdminsOfPromotion({
    userId: args.userId,
    actorId: args.actorId,
    summary: `was promoted to ${args.to} in ${domain?.displayName ?? "a domain"}`,
  });
}
