// DB-backed resolver for signing merge variables. Looks up the current term and
// the signer's name, then hands off to the pure resolveSigningVariables.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { nextTermCode } from "~/lib/terms.shared";
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
    upcomingTerm: term?.code ? nextTermCode(term.code) : "",
    today,
    memberName: user ? fullName(user) : "",
    supervisorName: opts.supervisorName ?? "",
  });
}
