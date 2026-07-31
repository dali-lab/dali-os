// Resolves where a signing document is put "in force". A binding's scopeKey
// disambiguates the context (Postgres treats NULLs in composite uniques as
// distinct), so app-scoped docs get one active binding while term/cycle-scoped
// docs get one per term/cycle.
//
//   App-scoped (membership, general)      -> "app"
//   Mentorship / Mentors audience         -> "term:<id>"   (current term)
//   Hiring confidentiality                -> "cycle:<id>"  (bound from hiring UI)

import type { SigningDocument } from "~/generated/prisma/client";
import { currentTerm } from "~/lib/roles";

export interface SigningScope {
  scopeKey: string;
  termId?: string;
  cycleId?: string;
}

type ScopeDoc = Pick<SigningDocument, "kind" | "audience" | "gateScope">;

// The scope an admin "Activate" action targets. Cycle-scoped confidentiality is
// bound from the hiring lead's cycle UI, not here, so this covers app + term.
export async function resolveAdminScope(doc: ScopeDoc): Promise<SigningScope | { error: string }> {
  const isTermly = doc.kind === "MentorshipAgreement" || doc.audience === "Mentors";
  if (isTermly) {
    const term = await currentTerm();
    if (!term) return { error: "No current term is configured to bind a termly agreement." };
    return { scopeKey: `term:${term.id}`, termId: term.id };
  }
  if (doc.gateScope === "HiringCycle" || doc.kind === "Confidentiality") {
    return { error: "Confidentiality agreements are bound to a cycle from the hiring lead's cycle setup." };
  }
  return { scopeKey: "app" };
}
