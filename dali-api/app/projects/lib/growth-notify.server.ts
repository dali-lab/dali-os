// Notification dispatch for Growth request submissions (level-up and
// domain-join). Resolves the target domain from the submission's raw answers
// using the same mapping logic the Growth board uses, then pings the current
// domain leads.
//
// Called best-effort AFTER the submission transaction commits — never blocks
// the member's "ok" response.

import { prisma } from "~/lib/db";
import { currentDomainLeadUserIds } from "~/lib/domains.server";
import { notify } from "~/lib/notify.server";
import type { GrowthSlot } from "./growth.server";
import { parseColumnMapping } from "./slot-roles";

type GrowthNotifyArgs = {
  slot: GrowthSlot;
  submitterUserId: string;
  submitterName: string;
  // The raw answers object from the submission.
  answers: Record<string, unknown>;
  // The bound form's raw column mapping (StaffingCycleFormBinding.columnMapping),
  // used to locate the target-domain answer. Parsed defensively here.
  columnMapping: unknown;
};

// Resolve the target domain id from a submission's raw answers via the
// binding's column mapping. Returns null when the mapping is absent or the
// answer can't be resolved to a known domain.
async function resolveDomainFromAnswers(
  answers: Record<string, unknown>,
  columnMapping: unknown,
): Promise<{ id: string; displayName: string } | null> {
  const mapping = parseColumnMapping(columnMapping);
  if (!mapping) return null;

  const domainEntry = mapping.entries.find(
    (e) => e.role === "target-domain" && e.source === "question",
  );
  if (!domainEntry || domainEntry.source !== "question") return null;

  const rawAnswer = answers[domainEntry.questionKey];
  if (typeof rawAnswer !== "string" || rawAnswer.length === 0) return null;

  // Try id lookup first; fall back to case-insensitive displayName match.
  const byId = await prisma.domain.findUnique({
    where: { id: rawAnswer },
    select: { id: true, displayName: true },
  });
  if (byId) return byId;

  const byName = await prisma.domain.findFirst({
    where: { displayName: { equals: rawAnswer, mode: "insensitive" } },
    select: { id: true, displayName: true },
  });
  return byName ?? null;
}

export async function notifyGrowthRequest(args: GrowthNotifyArgs): Promise<void> {
  try {
    const domain = await resolveDomainFromAnswers(args.answers, args.columnMapping);
    if (!domain) return; // can't notify without a resolved domain

    const recipientIds = await currentDomainLeadUserIds(domain.id);
    if (recipientIds.length === 0) return;

    const recipients = recipientIds.map((userId) => ({ userId }));

    if (args.slot === "level-up") {
      await notify({
        eventType: "domain.level-up-requested",
        message: {
          title: `${args.submitterName} requested a level up in ${domain.displayName}`,
          link: "/core/growth",
        },
        recipients,
      });
    } else {
      await notify({
        eventType: "domain.transfer-requested",
        message: {
          title: `${args.submitterName} requested to join ${domain.displayName}`,
          link: "/core/growth",
        },
        recipients,
      });
    }
  } catch (err) {
    // Best-effort — never block the submission response.
    console.error("[growth-notify] failed to notify domain leads:", err);
  }
}
