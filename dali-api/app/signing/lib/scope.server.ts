// Resolves where a signing document is put "in force". A binding's scopeKey
// disambiguates the context (Postgres treats NULLs in composite uniques as
// distinct), so app-scoped docs get one active binding while term/cycle-scoped
// docs get one per term/cycle. Driven by the document's cadence:
//
//   Once     -> "app"          (one standing binding)
//   PerTerm  -> "term:<id>"    (current term)
//   PerCycle -> "cycle:<id>"   (bound from hiring UI, not here)

import type { SigningDocument } from "~/generated/prisma/client";
import { currentTerm } from "~/lib/roles";

export interface SigningScope {
  scopeKey: string;
  termId?: string;
  cycleId?: string;
}

type ScopeDoc = Pick<SigningDocument, "cadence">;

// The scope an admin "Activate" action (or the signing-issuance job) targets for
// the current period. Cycle-scoped agreements are bound from the hiring lead's
// cycle UI, not here, so this covers Once + PerTerm.
export async function resolveAdminScope(doc: ScopeDoc): Promise<SigningScope | { error: string }> {
  if (doc.cadence === "PerTerm") {
    const term = await currentTerm();
    if (!term) return { error: "No current term is configured to bind a termly agreement." };
    return { scopeKey: `term:${term.id}`, termId: term.id };
  }
  if (doc.cadence === "PerCycle") {
    return { error: "Per-cycle agreements are bound to a cycle from the hiring lead's cycle setup." };
  }
  return { scopeKey: "app" };
}
