// Shared data source for the member wallet pass face (Apple + Google). Both pass
// builders resolve the same fields here so the two platforms stay in lockstep:
// name, primary domain, class year, onboarding term, and Core status.
//
// Every field except the name is optional and omitted from the pass when unknown,
// so a partially-onboarded member still gets a valid pass.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { dateToTermCode } from "~/lib/terms.shared";

export type WalletPassFields = {
  /** "Rachael Huang" — always present (may be a single name if lastName is blank). */
  name: string;
  /** Primary domain code, e.g. "Des". Null if the member has no domain eligibility. */
  domainCode: string | null;
  /** Class year, short form e.g. "'27". Null if unknown. */
  classYearShort: string | null;
  /** Onboarding term, e.g. "24S", derived from DALIMember.onboardedAt. Null if unknown. */
  memberSinceTerm: string | null;
  /** Whether the member is Core (or Admin) — drives the "Core" badge cell. */
  isCore: boolean;
};

/**
 * Resolve the fields shown on a member's wallet pass. Throws if the user is not
 * found. `domainCode` is the member's earliest non-system domain eligibility;
 * intern-program domains still count (a member's only domain during their intern
 * term), CORE and other system pseudo-domains do not.
 */
export async function resolveWalletPassFields(userId: string): Promise<WalletPassFields> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      classYear: true,
      daliMember: { select: { onboardedAt: true } },
      domainEligibilities: {
        where: { domain: { isSystem: false } },
        orderBy: { promotedAt: "asc" },
        take: 1,
        select: { domain: { select: { code: true } } },
      },
    },
  });
  if (!user) throw new Error(`User not found: ${userId}`);

  return {
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    domainCode: user.domainEligibilities[0]?.domain.code ?? null,
    classYearShort: user.classYear ? `'${String(user.classYear).slice(-2)}` : null,
    memberSinceTerm: user.daliMember?.onboardedAt
      ? dateToTermCode(user.daliMember.onboardedAt)
      : null,
    isCore: await isCore(userId),
  };
}
