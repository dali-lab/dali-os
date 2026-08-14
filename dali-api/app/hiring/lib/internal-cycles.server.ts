import type { ApplicationCycleType } from "~/generated/prisma/client";
import type { EventType } from "~/lib/notification-events";
import { eligibleInternUserIds, isFellowshipEligible } from "./intern-eligibility";
import { resolveAllLabMembers } from "~/lib/groups";
import { promoteToMember } from "~/members/lib/membership.server";
import { provisionNewMember, type ProvisionResult } from "~/members/lib/provisioning.server";
import { sendWelcome } from "~/members/lib/welcome.server";
import { isCoreCycleEligible, defaultCoreReviewerIds, coreOnAccept } from "./core-hiring.server";

// "Internal" cycle types share the member-authed applicant portal, a DB-backed
// shortform (no per-domain challenges), no interviews, a single reviewer pool,
// and a single Final delibs round. Everything that differs between them lives
// in INTERNAL_CYCLES below so the shared machinery (portal, setup, status
// fan-out, decision release) stays cycle-type-agnostic.
export type InternalCycleType = "Fellowship" | "Core";

export function isInternalCycleType(t: ApplicationCycleType): t is InternalCycleType {
  return t === "Fellowship" || t === "Core";
}

export interface AcceptContext {
  userId: string;
  actorId: string;
  domainId: string; // the DomainApplication's target domain (real for Fellowship, the CORE domain for Core)
  firstName: string;
  candidateEmail: string | null;
}

export interface AcceptResult {
  // Extra fields merged into the release audit-log metadata.
  auditMeta: Record<string, unknown>;
  // Account provisioning result (Fellowship) whose credentials get folded into
  // the acceptance email. Null for cycle types that don't provision accounts.
  provision: ProvisionResult | null;
}

export interface InternalCycleConfig {
  // Can this user apply to a cycle of this type right now?
  eligible(userId: string): Promise<boolean>;
  // Everyone eligible — recipients for the "cycle is open" fan-out.
  eligibleUserIds(): Promise<string[]>;
  // Seed the reviewer pool with these user IDs on cycle creation (editable
  // afterward). Null = no auto-default.
  defaultReviewerIds: (() => Promise<string[]>) | null;
  // "target-domains": applicant picks from the cycle's real target domains.
  // "single-core-domain": one synthetic CORE domain, no applicant choice.
  domainStrategy: "target-domains" | "single-core-domain";
  // How released decisions reach the applicant. "email": per-cycle email
  // binding (required). "inApp": in-app notification (binding optional).
  decisionChannel: "email" | "inApp";
  // Event used to notify the applicant in-app when channel === "inApp".
  decisionNotificationEvent: EventType | null;
  // Applicant portal path.
  portalPath: string;
  // "Cycle is open" invitation copy + delivery.
  openInvite: {
    eventType: EventType;
    link: string;
    title(cycleName: string): string;
    body(cycleName: string, closeText: string): string;
  };
  // Acceptance side-effect run when a Released "Accepted" decision fires.
  onAccept(ctx: AcceptContext): Promise<AcceptResult>;
}

// Shared acceptance path that turns an applicant into a lab member: promote to
// a DALIMember, grant P1 DomainEligibility in the target domain, provision the
// @dali.dartmouth.edu account + Slack invite, and file the persistent
// onboarding todo. Used by Fellowship cycles and (directly, in the release
// route) by Standard cycles. Best-effort: each side-effect is isolated.
export async function memberOnAccept(ctx: AcceptContext): Promise<AcceptResult> {
  const { created } = await promoteToMember({
    userId: ctx.userId,
    domainId: ctx.domainId,
    level: "P1",
    actorId: ctx.actorId,
  });

  let provision: ProvisionResult | null = null;
  try {
    provision = await provisionNewMember({ userId: ctx.userId, domainId: ctx.domainId });
  } catch (err) {
    console.error("Failed to provision new member:", err);
  }

  let welcomeNotified = false;
  try {
    const { notified } = await sendWelcome({
      userId: ctx.userId,
      actorId: ctx.actorId,
      firstName: ctx.firstName,
      email: ctx.candidateEmail,
      daliEmail: provision?.daliEmail ?? null,
    });
    welcomeNotified = notified;
  } catch (err) {
    console.error("Failed to send welcome:", err);
  }

  return { auditMeta: { memberPromoted: created, welcomeNotified }, provision };
}

export const INTERNAL_CYCLES: Record<InternalCycleType, InternalCycleConfig> = {
  Fellowship: {
    eligible: isFellowshipEligible,
    eligibleUserIds: eligibleInternUserIds,
    defaultReviewerIds: null,
    domainStrategy: "target-domains",
    decisionChannel: "email",
    decisionNotificationEvent: null,
    portalPath: "/fellowship",
    openInvite: {
      eventType: "hiring.fellowship_invite",
      link: "/fellowship",
      title: () => "Fellowship application is open",
      body: (name, closeText) => `${name} is accepting fellowship applications.${closeText}`,
    },
    onAccept: memberOnAccept,
  },
  Core: {
    eligible: isCoreCycleEligible,
    eligibleUserIds: resolveAllLabMembers,
    defaultReviewerIds: defaultCoreReviewerIds,
    domainStrategy: "single-core-domain",
    decisionChannel: "inApp",
    decisionNotificationEvent: "hiring.core_decision",
    portalPath: "/core",
    openInvite: {
      eventType: "hiring.core_invite",
      link: "/core",
      title: () => "Core application is open",
      body: (name, closeText) => `${name} is accepting Core applications.${closeText}`,
    },
    onAccept: coreOnAccept,
  },
};

// Convenience accessor — returns null for Standard (non-internal) cycles.
export function internalCycleConfig(
  cycleType: ApplicationCycleType,
): InternalCycleConfig | null {
  return isInternalCycleType(cycleType) ? INTERNAL_CYCLES[cycleType] : null;
}
