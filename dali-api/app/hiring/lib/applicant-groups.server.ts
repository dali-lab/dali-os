import type { ApplicationType, CycleApplicants } from "~/generated/prisma/client";
import type { EventType } from "~/lib/notification-events";
import { eligibleInternUserIds, isFellowshipEligible } from "./intern-eligibility";
import { resolveAllLabMembers } from "~/lib/groups";
import { promoteToMember } from "~/members/lib/membership.server";
import { provisionNewMember, type ProvisionResult } from "~/members/lib/provisioning.server";
import { sendWelcome } from "~/members/lib/welcome.server";
import { isCoreCycleEligible, defaultCoreReviewerIds, coreOnAccept } from "./core-hiring.server";
import { applicantPortalPath } from "./applicant-groups";

// Everything that differs by who a cycle is for lives in APPLICANT_GROUP_CONFIG
// below; the shared machinery (portals, setup, status fan-out, decision
// release) reads it rather than branching on the group. What a cycle *does*
// (challenges, initial delibs, interviews) is the stage toggles instead, see
// cycle-stages.ts. Client-safe helpers live in applicant-groups.ts.
export * from "./applicant-groups";

export interface AcceptContext {
  userId: string;
  actorId: string;
  domainId: string; // the DomainApplication's target domain (the CORE domain for Lab members)
  firstName: string;
  candidateEmail: string | null;
}

export interface AcceptResult {
  // Extra fields merged into the release audit-log metadata.
  auditMeta: Record<string, unknown>;
  // Account provisioning result whose credentials get folded into the
  // acceptance email. Null for groups that don't provision accounts.
  provision: ProvisionResult | null;
}

export interface ApplicantGroupConfig {
  // Can this user apply to a cycle for this group? Null = anyone who reaches
  // the portal (Students: any CAS-authed applicant).
  eligible: ((userId: string) => Promise<boolean>) | null;
  // Everyone eligible: recipients for the "cycle is open" fan-out. Null = no
  // fan-out (Students hear about cycles from the public site).
  eligibleUserIds: (() => Promise<string[]>) | null;
  // Seed the reviewer pool with these user IDs on cycle creation (editable
  // afterward). Null = no auto-default.
  defaultReviewerIds: (() => Promise<string[]>) | null;
  // "target-domains": applicant picks from the cycle's real domains.
  // "single-core-domain": one synthetic CORE domain, no applicant choice.
  domainStrategy: "target-domains" | "single-core-domain";
  // How released decisions reach the applicant. "email": per-cycle email
  // binding (required). "inApp": in-app notification (binding optional).
  decisionChannel: "email" | "inApp";
  // Event used to notify the applicant in-app when channel === "inApp".
  decisionNotificationEvent: EventType | null;
  // Stamped on each Application so it records what the person applied through.
  applicationType: ApplicationType;
  // "Cycle is open" invitation copy + delivery. Null when there's no fan-out.
  openInvite: {
    eventType: EventType;
    title(cycleName: string): string;
    body(cycleName: string, closeText: string): string;
  } | null;
  // Acceptance side-effect run when a Released "Accepted" decision fires.
  onAccept(ctx: AcceptContext): Promise<AcceptResult>;
}

// Shared acceptance path that turns an applicant into a lab member: promote to
// a DALIMember, grant P1 DomainEligibility in the target domain, provision the
// @dali.dartmouth.edu account + Slack invite, and file the persistent
// onboarding todo. Used by Students and Interns cycles. Best-effort: each
// side-effect is isolated.
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

export const APPLICANT_GROUP_CONFIG: Record<CycleApplicants, ApplicantGroupConfig> = {
  Students: {
    eligible: null,
    eligibleUserIds: null,
    defaultReviewerIds: null,
    domainStrategy: "target-domains",
    decisionChannel: "email",
    decisionNotificationEvent: null,
    applicationType: "Standard",
    openInvite: null,
    onAccept: memberOnAccept,
  },
  Interns: {
    eligible: isFellowshipEligible,
    eligibleUserIds: eligibleInternUserIds,
    defaultReviewerIds: null,
    domainStrategy: "target-domains",
    decisionChannel: "email",
    decisionNotificationEvent: null,
    applicationType: "Fellowship",
    openInvite: {
      eventType: "hiring.fellowship_invite",
      title: () => "Fellowship application is open",
      body: (name, closeText) => `${name} is accepting fellowship applications.${closeText}`,
    },
    onAccept: memberOnAccept,
  },
  LabMembers: {
    eligible: isCoreCycleEligible,
    eligibleUserIds: resolveAllLabMembers,
    defaultReviewerIds: defaultCoreReviewerIds,
    domainStrategy: "single-core-domain",
    decisionChannel: "inApp",
    decisionNotificationEvent: "hiring.core_decision",
    applicationType: "Core",
    openInvite: {
      eventType: "hiring.core_invite",
      title: () => "Core application is open",
      body: (name, closeText) => `${name} is accepting Core applications.${closeText}`,
    },
    onAccept: coreOnAccept,
  },
};

/** The group's config plus the per-cycle portal link. */
export function applicantGroup(applicants: CycleApplicants, cycleId: string) {
  return { ...APPLICANT_GROUP_CONFIG[applicants], portalPath: applicantPortalPath(applicants, cycleId) };
}
