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

// Natural-language join for a name list: "A", "A and B", "A, B, and C".
// Dedups and drops blanks so a mentor's list reads cleanly on their copy.
function joinNames(names: string[]): string {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (clean.length <= 1) return clean[0] ?? "";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

// Resolve {{menteeName}} for one signer's copy. The mentee's own copy names the
// mentee (they are the signer). A mentor's copy names the mentee(s) they mentor
// this term — the mentorship agreement is one shared binding, not per-pair, so a
// mentor with several mentees sees them all. Needs a bound term to have a pair.
async function resolveMenteeName(
  signerUserId: string,
  role: "member" | "mentee",
  termId: string | undefined,
  selfName: string,
): Promise<string> {
  if (!termId) return "";
  if (role === "mentee") return selfName;
  const pairs = await prisma.mentorshipPair.findMany({
    where: { mentorUserId: signerUserId, termId },
    select: { mentee: { select: { firstName: true, lastName: true } } },
  });
  return joinNames(pairs.map((p) => fullName(p.mentee)));
}

export async function resolveSigningVariablesForSigner(
  signerUserId: string,
  opts: {
    supervisorName?: string;
    termCode?: string;
    // The acting signer's role and the binding's term, so {{menteeName}} can
    // resolve the counterpart. Both optional: a caller with no term context
    // (or a non-mentorship document) leaves {{menteeName}} empty.
    role?: "member" | "mentee";
    termId?: string;
  } = {},
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
  const memberName = user ? fullName(user) : "";
  const menteeName = await resolveMenteeName(
    signerUserId,
    opts.role ?? "member",
    opts.termId,
    memberName,
  );
  return resolveSigningVariables({
    term: termCode,
    upcomingTerm: termCode ? nextTermCode(termCode) : "",
    today,
    memberName,
    supervisorName: opts.supervisorName ?? "",
    menteeName,
  });
}
