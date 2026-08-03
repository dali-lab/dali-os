// DB-backed resolver for signing merge variables. Looks up the current term and
// the signer's name, then hands off to the pure resolveSigningVariables.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { resolveSigningVariables, type SigningVariableName } from "~/lib/signing-variables";

export async function resolveSigningVariablesForSigner(
  signerUserId: string,
  opts: { supervisorName?: string } = {},
): Promise<Record<SigningVariableName, string>> {
  const [term, user] = await Promise.all([
    currentTerm(),
    prisma.user.findUnique({
      where: { id: signerUserId },
      select: { firstName: true, lastName: true },
    }),
  ]);
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return resolveSigningVariables({
    term: term?.code ?? "",
    today,
    memberName: user ? fullName(user) : "",
    supervisorName: opts.supervisorName ?? "",
  });
}

// Per-application merge values for a PartnerContract: the org / legal entity /
// fee come off the application, the term is its earliest target term (falling
// back to the current term), and memberName/today are the signer + sign date.
// Used by both the sign preview and recordSignature so the frozen copy matches
// what the partner saw.
export async function resolvePartnerContractVariables(
  applicationId: string,
  signerUserId: string,
): Promise<Record<SigningVariableName, string>> {
  const [app, user, current] = await Promise.all([
    prisma.partnerApplication.findUnique({
      where: { id: applicationId },
      select: {
        contractFee: true,
        legalEntityName: true,
        legalEntityAddress: true,
        partnerOrg: { select: { name: true } },
        applicant: { select: { firstName: true, lastName: true } },
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          take: 1,
          select: { term: { select: { code: true } } },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: signerUserId },
      select: { firstName: true, lastName: true },
    }),
    currentTerm(),
  ]);
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const orgName =
    app?.partnerOrg?.name ??
    (app?.applicant ? fullName(app.applicant) : "") ??
    "";
  return resolveSigningVariables({
    term: app?.targetTerms[0]?.term.code ?? current?.code ?? "",
    today,
    memberName: user ? fullName(user) : "",
    orgName,
    legalEntityName: app?.legalEntityName ?? "",
    legalEntityAddress: app?.legalEntityAddress ?? "",
    fee: app?.contractFee ?? "",
  });
}
