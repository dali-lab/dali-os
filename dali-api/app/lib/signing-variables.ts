// Merge variables for signing documents — the {{...}} tokens an author can drop
// into a template body (as `variable` nodes) that resolve to real values at
// fill/render time. The vocabulary + placeholder grammar live in the shared
// app/lib/template-variables.ts; this module owns the signing subset and its
// pure resolver. The DB-backed resolver that fetches term/name lives in
// app/signing/lib (it calls resolveSigningVariables with what it looked up).

import {
  TEMPLATE_VARIABLES_REGISTRY,
  extractPlaceholders,
  findUnknownPlaceholders,
} from "~/lib/template-variables";

export const SIGNING_VARIABLE_DESCRIPTIONS = {
  term: TEMPLATE_VARIABLES_REGISTRY.term.description,
  upcomingTerm: TEMPLATE_VARIABLES_REGISTRY.upcomingTerm.description,
  today: TEMPLATE_VARIABLES_REGISTRY.today.description,
  memberName: TEMPLATE_VARIABLES_REGISTRY.memberName.description,
  supervisorName: TEMPLATE_VARIABLES_REGISTRY.supervisorName.description,
} as const;

export type SigningVariableName = keyof typeof SIGNING_VARIABLE_DESCRIPTIONS;

export const ALL_SIGNING_VARIABLES = Object.keys(
  SIGNING_VARIABLE_DESCRIPTIONS,
) as SigningVariableName[];

export function isKnownSigningVariable(name: string): name is SigningVariableName {
  return name in SIGNING_VARIABLE_DESCRIPTIONS;
}

// Re-export the shared extractor under the signing-specific name so existing
// importers/tests keep their entry point.
export const extractSigningPlaceholders = extractPlaceholders;

// Soft lint: unknown tokens (typos / bogus vars). Callers render as warnings.
export function lintSigningText(text: string): { unknown: string[] } {
  return { unknown: findUnknownPlaceholders(text, Object.keys(SIGNING_VARIABLE_DESCRIPTIONS)) };
}

// Inputs the caller has already resolved (term code, signer name, etc.). Kept
// pure so it's trivially testable; the server wrapper does the DB lookups.
export interface SigningVariableInputs {
  term?: string;
  upcomingTerm?: string;
  today?: string;
  memberName?: string;
  supervisorName?: string;
}

export function resolveSigningVariables(
  inputs: SigningVariableInputs,
): Record<SigningVariableName, string> {
  return {
    term: inputs.term ?? "",
    upcomingTerm: inputs.upcomingTerm ?? "",
    today: inputs.today ?? "",
    memberName: inputs.memberName ?? "",
    supervisorName: inputs.supervisorName ?? "",
  };
}
