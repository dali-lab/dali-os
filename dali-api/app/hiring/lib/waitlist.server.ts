// Post-cycle waitlist management.
//
// The cycle-running flow puts applicants on the waitlist via the Final delibs
// kanban — each waitlisted DomainApplication gets a Released Decision with
// type=Waitlisted and a positional `waitlistRank`. This module is what happens
// *after* the cycle closes: Core needs to view everyone still waitlisted across
// all cycles, accept someone off the list when a spot opens, or remove someone
// who's no longer relevant.
//
// Two rules worth knowing before reading this file:
//
//  1. Decisions are append-only — except `waitlistRank`. When the active
//     waitlist shifts (someone accepted or removed, or Core reorders it), we
//     MUTATE the rank field on the existing Released Waitlisted Decision rows.
//     The append-only invariant on every other field still holds. Ranks form
//     one order per domain across cycles: each cycle's delibs numbers from #1,
//     so a new cycle can tie an old one until Core reorders (`reorderWaitlist`).
//
//  2. An "active" waitlist entry means the *latest Released Decision* for that
//     DomainApplication has type=Waitlisted. Once we append a new
//     Accepted/Rejected Released Decision, the previous Waitlisted entry
//     becomes inactive automatically because the latest-released record wins.

import { prisma } from "~/lib/db";
import type { CycleApplicants } from "~/generated/prisma/enums";
import { renderForSlot, decisionSlot } from "~/hiring/lib/email-variables";
import { logAuditEvent } from "~/lib/audit";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { promoteToMember } from "~/members/lib/membership.server";
import {
  sendWelcome,
  onboardingEmailHtml,
} from "~/members/lib/welcome.server";
import {
  provisionNewMember,
  type ProvisionResult,
} from "~/members/lib/provisioning.server";
import {
  resolveCandidateEmail,
  redirectBannerHtml,
} from "~/lib/candidate-email";
import type { Prisma } from "~/generated/prisma/client";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { compactRanks } from "~/hiring/lib/waitlist";

// ─── List ────────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  domainApplicationId: string;
  decisionId: string;
  rank: number;
  waitlistedAt: Date;
  applicant: {
    userId: string;
    firstName: string | null;
    lastName: string | null;
    dartmouthEmail: string | null;
  };
  domain: {
    id: string;
    name: string;
    displayName: string | null;
  };
  cycle: {
    id: string;
    name: string;
    applicants: CycleApplicants;
    status: string;
  };
}

/**
 * Returns every DomainApplication whose latest Released Decision is
 * Waitlisted, optionally restricted to one cycle. Sorted by domain
 * (display name) then ascending rank.
 */
export async function listActiveWaitlistEntries(opts?: {
  cycleId?: string;
  domainId?: string;
}): Promise<WaitlistEntry[]> {
  // Pull candidates that have *any* released waitlisted decision; then filter
  // app-side to those where the LATEST released decision is still Waitlisted
  // (i.e. not superseded by a later Accept or Reject).
  const candidates = await prisma.domainApplication.findMany({
    where: {
      decisions: { some: { stage: "Released", type: "Waitlisted" } },
      ...(opts?.cycleId
        ? { application: { applicationCycleId: opts.cycleId } }
        : {}),
      ...(opts?.domainId ? { domainId: opts.domainId } : {}),
    },
    include: {
      domain: {
        select: { id: true, name: true, displayName: true },
      },
      decisions: {
        where: { stage: "Released" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      application: {
        select: {
          applicationCycleId: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dartmouthEmail: true,
            },
          },
          applicationCycle: {
            select: {
              id: true,
              name: true,
              applicants: true,
              statusUpdates: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { newStatus: true },
              },
            },
          },
        },
      },
    },
  });

  const entries: WaitlistEntry[] = [];
  for (const da of candidates) {
    const latest = da.decisions[0];
    if (!latest || latest.type !== "Waitlisted") continue;
    entries.push({
      domainApplicationId: da.id,
      decisionId: latest.id,
      rank: latest.waitlistRank ?? Number.MAX_SAFE_INTEGER,
      waitlistedAt: latest.createdAt,
      applicant: {
        userId: da.application.user.id,
        firstName: da.application.user.firstName,
        lastName: da.application.user.lastName,
        dartmouthEmail: da.application.user.dartmouthEmail,
      },
      domain: {
        id: da.domain.id,
        name: da.domain.name,
        displayName: da.domain.displayName,
      },
      cycle: {
        id: da.application.applicationCycle.id,
        name: da.application.applicationCycle.name,
        applicants: da.application.applicationCycle.applicants,
        status:
          da.application.applicationCycle.statusUpdates[0]?.newStatus ??
          "Draft",
      },
    });
  }

  entries.sort((a, b) => {
    const ad = a.domain.displayName ?? a.domain.name;
    const bd = b.domain.displayName ?? b.domain.name;
    if (ad !== bd) return ad.localeCompare(bd);
    return a.rank - b.rank;
  });
  return entries;
}

// ─── Shared rank shift ───────────────────────────────────────────────────────

/**
 * Close the gap someone left in a domain's waitlist: re-number every active
 * Waitlisted Released Decision in the domain, across cycles, with
 * `compactRanks` so the order holds and unresolved ties stay tied.
 *
 * Mutating waitlistRank in place is the one carve-out from the Decision
 * append-only invariant. See file header. We constrain by `id` to the latest
 * Released Decision for each DomainApplication so we don't touch historical
 * superseded rows.
 */
async function compactDomainRanks(
  tx: Prisma.TransactionClient,
  domainId: string,
): Promise<void> {
  const candidates = await tx.domainApplication.findMany({
    where: {
      domainId,
      decisions: { some: { stage: "Released", type: "Waitlisted" } },
    },
    select: {
      decisions: {
        where: { stage: "Released" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, type: true, waitlistRank: true },
      },
    },
  });

  const ranked: Array<{ id: string; rank: number }> = [];
  for (const da of candidates) {
    const latest = da.decisions[0];
    if (!latest || latest.type !== "Waitlisted") continue;
    if (latest.waitlistRank == null) continue;
    ranked.push({ id: latest.id, rank: latest.waitlistRank });
  }

  const next = compactRanks(ranked.map((r) => r.rank));
  // updateMany can't do row-specific values, so we batch one-shot updates.
  for (const [i, r] of ranked.entries()) {
    if (next[i] === r.rank) continue;
    await tx.decision.update({
      where: { id: r.id },
      data: { waitlistRank: next[i] },
    });
  }
}

async function currentCycleStatus(
  tx: Prisma.TransactionClient,
  cycleId: string,
): Promise<string> {
  const last = await tx.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
    select: { newStatus: true },
  });
  return last?.newStatus ?? "Draft";
}

// ─── Accept off waitlist ─────────────────────────────────────────────────────

export type AcceptResult =
  | { ok: true; releasedDecisionId: string; cycleReopened: boolean }
  | {
      ok: false;
      reason:
        | "not-found"
        | "not-waitlisted"
        | "no-email-binding"
        | "no-domain";
      message: string;
    };

/**
 * Accept someone off the waitlist:
 *  1. If the cycle is Completed, force-transition it back to UnderReview so a
 *     new Released Decision still belongs to a live cycle.
 *  2. Append a new Released Decision (type=Accepted) on the same
 *     DomainApplication. Re-uses the same side-effects as the standard
 *     release flow: promoteToMember, provisionNewMember, sendWelcome,
 *     templated email send.
 *  3. Close the gap in the domain's waitlist ranks.
 *  4. Re-complete the cycle if we reopened it in step 1.
 *
 * Per design: this is Core-only. The caller is responsible for permission
 * checking; this function just performs the action.
 */
export async function acceptFromWaitlist(args: {
  domainApplicationId: string;
  actorId: string;
  request: Request;
}): Promise<AcceptResult> {
  const { domainApplicationId, actorId, request } = args;

  const da = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: {
      domain: { select: { id: true, name: true, displayName: true } },
      application: {
        select: {
          applicationCycleId: true,
          userId: true,
          user: {
            select: { firstName: true, dartmouthEmail: true, netId: true },
          },
        },
      },
      decisions: {
        where: { stage: "Released" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!da) {
    return { ok: false, reason: "not-found", message: "Domain application not found." };
  }
  if (!da.domain) {
    return { ok: false, reason: "no-domain", message: "Domain application has no linked domain." };
  }
  const latest = da.decisions[0];
  if (!latest || latest.type !== "Waitlisted") {
    return {
      ok: false,
      reason: "not-waitlisted",
      message: "Applicant is not currently on the waitlist.",
    };
  }

  const cycleId = da.application.applicationCycleId;
  const binding = await getHiringEmail(decisionSlot("Accepted"));
  if (!binding) {
    return {
      ok: false,
      reason: "no-email-binding",
      message:
        "There's no Accepted email yet. Write one on a cycle's Setup tab before accepting off the waitlist.",
    };
  }

  // Transactional core: reopen → create Released Accept → shift ranks → re-complete.
  // Side-effects (provisioning, email) run after the transaction so a Gmail or
  // Workspace API blip doesn't roll back the membership grant.
  const cycleStatusBefore = await currentCycleStatus(prisma, cycleId);
  const reopened = cycleStatusBefore === "Completed";

  const released = await prisma.$transaction(async (tx) => {
    if (reopened) {
      await tx.applicationCycleStatusUpdate.create({
        data: {
          applicationCycleId: cycleId,
          newStatus: "UnderReview",
          userId: actorId,
        },
      });
    }

    const rel = await tx.decision.create({
      data: {
        domainApplicationId: domainApplicationId,
        type: "Accepted",
        stage: "Released",
        madeById: actorId,
        notes: "Accepted off the waitlist.",
        parentDecisionId: latest.id,
      },
    });

    await compactDomainRanks(tx, da.domain.id);

    if (reopened) {
      await tx.applicationCycleStatusUpdate.create({
        data: {
          applicationCycleId: cycleId,
          newStatus: "Completed",
          userId: actorId,
        },
      });
    }

    return rel;
  });

  // Membership + provisioning. Mirrors api.decisions.$id.release.ts. Each step
  // is best-effort: failures are logged, never thrown, so a partial side-effect
  // failure doesn't leave the Released Decision orphaned.
  let memberPromoted = false;
  let welcomeNotified = false;
  let provisionResult: ProvisionResult | null = null;
  try {
    const { created } = await promoteToMember({
      userId: da.application.userId,
      domainId: da.domain.id,
      level: "P1",
      actorId,
    });
    memberPromoted = created;
  } catch (err) {
    console.error("waitlist accept: promoteToMember failed:", err);
  }

  try {
    provisionResult = await provisionNewMember({
      userId: da.application.userId,
      domainId: da.domain.id,
    });
  } catch (err) {
    console.error("waitlist accept: provisionNewMember failed:", err);
  }

  try {
    const u = da.application.user;
    const welcomeEmail =
      u?.dartmouthEmail ?? (u?.netId ? `${u.netId}@dartmouth.edu` : null);
    const { notified } = await sendWelcome({
      userId: da.application.userId,
      actorId,
      firstName: u?.firstName ?? "",
      email: welcomeEmail,
      daliEmail: provisionResult?.daliEmail ?? null,
    });
    welcomeNotified = notified;
  } catch (err) {
    console.error("waitlist accept: sendWelcome failed:", err);
  }

  // Acceptance email — same template + onboarding block as the standard
  // release path, so the recipient sees one combined message.
  let emailSent = false;
  let _waitlistEmailId: string | null = null;
  try {
    const user = da.application.user;
    const intendedEmail =
      user?.dartmouthEmail ??
      (user?.netId ? `${user.netId}@dartmouth.edu` : null);
    const domainName = da.domain.displayName ?? da.domain.name ?? "";
    const { to, redirectedFrom } = resolveCandidateEmail(intendedEmail);
    if (to && user) {
      const { subject, html } = renderForSlot(
        decisionSlot("Accepted"),
        binding,
        { firstName: user.firstName, domain: domainName },
      );
      const onboarding = onboardingEmailHtml(
        provisionResult?.daliEmail ?? null,
        provisionResult?.daliTempPassword ?? null,
      );
      const { id, deduped } = await enqueueOutbound({
        channel: "email",
        purpose: "Hiring",
        dedupKey: `hiring.waitlist.accept:${domainApplicationId}`,
        target: to,
        recipientUserId: da.application.userId,
        subject,
        bodyHtml: redirectBannerHtml(redirectedFrom) + html + onboarding,
        eventType: "hiring.waitlist.accept",
      });
      _waitlistEmailId = id;
      emailSent = !deduped;
    }
  } catch (err) {
    console.error("waitlist accept: email send failed:", err);
  }

  const provisioningForAudit = provisionResult
    ? (() => {
        const { daliTempPassword: _omit, ...rest } = provisionResult;
        return rest;
      })()
    : null;

  await logAuditEvent({
    action: "waitlist.accept",
    userId: actorId,
    targetId: released.id,
    metadata: {
      decisionId: released.id,
      parentDecisionId: latest.id,
      domainApplicationId,
      cycleId,
      domainId: da.domain.id,
      acceptedFromRank: latest.waitlistRank,
      cycleReopened: reopened,
      emailSent,
      memberPromoted,
      welcomeNotified,
      provisioning: provisioningForAudit,
    },
    request,
  });

  await drainNow([_waitlistEmailId]);

  return { ok: true, releasedDecisionId: released.id, cycleReopened: reopened };
}

// ─── Remove from waitlist ────────────────────────────────────────────────────

export type RemoveResult =
  | { ok: true; releasedDecisionId: string }
  | {
      ok: false;
      reason: "not-found" | "not-waitlisted" | "no-domain";
      message: string;
    };

/**
 * Take someone off the waitlist without accepting them. Appends a Released
 * Decision with type=Rejected (per design: the trade-off is that this looks
 * identical to "rejected during cycle" in pure-history views — but the prior
 * Waitlisted Released row remains in the lineage if anyone needs to dig).
 *
 * No email goes out: Core has already handled the human conversation.
 */
export async function removeFromWaitlist(args: {
  domainApplicationId: string;
  actorId: string;
  request: Request;
}): Promise<RemoveResult> {
  const { domainApplicationId, actorId, request } = args;

  const da = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: {
      domain: { select: { id: true } },
      application: { select: { applicationCycleId: true } },
      decisions: {
        where: { stage: "Released" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!da) {
    return { ok: false, reason: "not-found", message: "Domain application not found." };
  }
  if (!da.domain) {
    return { ok: false, reason: "no-domain", message: "Domain application has no linked domain." };
  }
  const latest = da.decisions[0];
  if (!latest || latest.type !== "Waitlisted") {
    return {
      ok: false,
      reason: "not-waitlisted",
      message: "Applicant is not currently on the waitlist.",
    };
  }

  const cycleId = da.application.applicationCycleId;

  const released = await prisma.$transaction(async (tx) => {
    const rel = await tx.decision.create({
      data: {
        domainApplicationId,
        type: "Rejected",
        stage: "Released",
        madeById: actorId,
        notes: "Removed from the waitlist.",
        parentDecisionId: latest.id,
      },
    });
    await compactDomainRanks(tx, da.domain.id);
    return rel;
  });

  await logAuditEvent({
    action: "waitlist.remove",
    userId: actorId,
    targetId: released.id,
    metadata: {
      decisionId: released.id,
      parentDecisionId: latest.id,
      domainApplicationId,
      cycleId,
      domainId: da.domain.id,
      removedFromRank: latest.waitlistRank,
    },
    request,
  });

  return { ok: true, releasedDecisionId: released.id };
}

// ─── Reorder ─────────────────────────────────────────────────────────────────

export type ReorderResult =
  | { ok: true }
  | { ok: false; reason: "stale"; message: string };

/**
 * Set a domain's waitlist order explicitly: `order` lists its active entries
 * top to bottom and each gets rank 1..N. This is how Core resolves ties
 * between cycles. `visible` narrows the entries the caller may see (Lab
 * members cycles are Admin-only); hidden entries keep their ranks.
 */
export async function reorderWaitlist(args: {
  domainId: string;
  order: string[];
  visible: (entry: WaitlistEntry) => boolean;
  actorId: string;
  request: Request;
}): Promise<ReorderResult> {
  const { domainId, order, visible, actorId, request } = args;

  const entries = (await listActiveWaitlistEntries({ domainId })).filter(visible);
  const byId = new Map(entries.map((e) => [e.domainApplicationId, e]));
  if (
    order.length !== entries.length ||
    new Set(order).size !== order.length ||
    !order.every((id) => byId.has(id))
  ) {
    return {
      ok: false,
      reason: "stale",
      message: "This waitlist changed since you loaded it. Refresh and try again.",
    };
  }

  await prisma.$transaction(async (tx) => {
    for (const [i, id] of order.entries()) {
      const entry = byId.get(id)!;
      if (entry.rank === i + 1) continue;
      await tx.decision.update({
        where: { id: entry.decisionId },
        data: { waitlistRank: i + 1 },
      });
    }
  });

  await logAuditEvent({
    action: "waitlist.reorder",
    userId: actorId,
    targetId: domainId,
    metadata: {
      domainId,
      before: entries.map((e) => ({ domainApplicationId: e.domainApplicationId, rank: e.rank })),
      order,
    },
    request,
  });

  return { ok: true };
}
