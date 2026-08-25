// DB-backed resolver for signing merge variables. Resolves {{term}} to the
// binding's term (opts.termCode — so an agreement issued for a not-yet-started
// term reads that term, not today's), falling back to the current term for
// app-scoped agreements with no bound term. {{upcomingTerm}} is always the one
// after {{term}}. Then hands off to the pure resolveSigningVariables.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { nextTermCode } from "~/lib/terms.shared";
import { fullName } from "~/lib/display";
import { resolveSigningVariables, type SigningVariableName } from "~/lib/signing-variables";

export async function resolveSigningVariablesForSigner(
  signerUserId: string,
  opts: { supervisorName?: string; termCode?: string } = {},
): Promise<Record<SigningVariableName, string>> {
  const [term, user] = await Promise.all([
    // Only look up the current term when the caller didn't pass a bound term.
    opts.termCode == null ? currentTerm() : null,
    prisma.user.findUnique({
      where: { id: signerUserId },
      select: { firstName: true, lastName: true },
    }),
  ]);
  const termCode = opts.termCode ?? term?.code ?? "";
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return resolveSigningVariables({
    term: termCode,
    upcomingTerm: termCode ? nextTermCode(termCode) : "",
    today,
    memberName: user ? fullName(user) : "",
    supervisorName: opts.supervisorName ?? "",
  });
}
