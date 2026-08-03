// Merge variables for signing documents — the {{...}} tokens an author can drop
// into a template body (as `variable` nodes) that resolve to real values at
// fill/render time. Mirrors the shape of app/hiring/lib/email-variables.ts but
// stays dependency-free so both the client editor and the server can use it.
// The DB-backed resolver that fetches term/name lives in app/signing/lib (it
// calls resolveSigningVariables with the values it looked up).

export const SIGNING_VARIABLE_DESCRIPTIONS = {
  term: "The current term code, e.g. 26S.",
  today: "The date the document is signed (Eastern Time).",
  memberName: "The signer's full name.",
  supervisorName: "The DALI staff supervisor's name.",
  // Partner-contract merge values (resolved per application when signing a
  // PartnerContract; empty on member/mentorship/confidentiality documents).
  orgName: "The partner organization's name.",
  legalEntityName: "The partner's legal entity name.",
  legalEntityAddress: "The partner's legal entity address.",
  fee: "The contract fee (free text).",
} as const;

export type SigningVariableName = keyof typeof SIGNING_VARIABLE_DESCRIPTIONS;

export const ALL_SIGNING_VARIABLES = Object.keys(
  SIGNING_VARIABLE_DESCRIPTIONS,
) as SigningVariableName[];

export function isKnownSigningVariable(name: string): name is SigningVariableName {
  return name in SIGNING_VARIABLE_DESCRIPTIONS;
}

// Same strict shape as the email interpolator: `{{name}}` with no whitespace,
// ascii-letter-led identifier.
const PLACEHOLDER_RE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function extractSigningPlaceholders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.push(m[1]);
  return out;
}

// Soft lint: unknown tokens (typos / bogus vars). Callers render as warnings.
export function lintSigningText(text: string): { unknown: string[] } {
  const unknown = new Set<string>();
  for (const tok of extractSigningPlaceholders(text)) {
    if (!isKnownSigningVariable(tok)) unknown.add(tok);
  }
  return { unknown: [...unknown] };
}

// Inputs the caller has already resolved (term code, signer name, etc.). Kept
// pure so it's trivially testable; the server wrapper does the DB lookups.
export interface SigningVariableInputs {
  term?: string;
  today?: string;
  memberName?: string;
  supervisorName?: string;
  orgName?: string;
  legalEntityName?: string;
  legalEntityAddress?: string;
  fee?: string;
}

export function resolveSigningVariables(
  inputs: SigningVariableInputs,
): Record<SigningVariableName, string> {
  return {
    term: inputs.term ?? "",
    today: inputs.today ?? "",
    memberName: inputs.memberName ?? "",
    supervisorName: inputs.supervisorName ?? "",
    orgName: inputs.orgName ?? "",
    legalEntityName: inputs.legalEntityName ?? "",
    legalEntityAddress: inputs.legalEntityAddress ?? "",
    fee: inputs.fee ?? "",
  };
}
