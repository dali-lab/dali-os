// Merge variables for a form's question text — the {{...}} tokens an author
// can drop into a label, description or option so ONE form serves every round
// of a staffing slot instead of being copied per term. The vocabulary and the
// placeholder grammar live in the shared app/lib/template-variables.ts (the
// same tokens email and signing use); this module owns the forms subset and
// its pure resolver, mirroring app/lib/signing-variables.ts.

import {
  TEMPLATE_VARIABLES_REGISTRY,
  findUnknownPlaceholders,
  variablesForContext,
} from "~/lib/template-variables";

export const FORM_VARIABLE_DESCRIPTIONS = {
  term: TEMPLATE_VARIABLES_REGISTRY.term.description,
} as const;

export type FormVariableName = keyof typeof FORM_VARIABLE_DESCRIPTIONS;

// Derived from the registry rather than restated, so offering a new token to
// form authors is a one-line registry change (see variablesForContext).
export const ALL_FORM_VARIABLES = variablesForContext("form");

// Soft lint: tokens that aren't offered on this surface (typos, or a signing
// token pasted into a form). Callers render as warnings, never as a block.
export function lintFormText(text: string): { unknown: string[] } {
  return {
    unknown: findUnknownPlaceholders(text, Object.keys(FORM_VARIABLE_DESCRIPTIONS)),
  };
}

// Unlike signing's resolver, an unresolved term is OMITTED rather than blanked:
// interpolateVars leaves a token it has no value for as literal text, so an
// unbound form shows "{{term}}" (a visible misconfiguration a manager can fix)
// instead of a sentence with a hole in it.
export function resolveFormVariables(inputs: {
  term?: string | null;
}): Record<string, string> {
  return inputs.term ? { term: inputs.term } : {};
}
