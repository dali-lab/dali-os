// The week 5 check-in forms linked to a term's mentorship notes page, per domain. Lives
// apart from the server loader so the grid and its tests can import it without
// a Prisma client.

export const TERM_FORM_ROLES = ["mentee", "mentor"] as const;
export type TermFormRole = (typeof TERM_FORM_ROLES)[number];

export function isTermFormRole(v: unknown): v is TermFormRole {
  return TERM_FORM_ROLES.some((r) => r === v);
}

export type TermFormResponse = {
  submittedAt: string;
  rows: { key: string; label: string; value: string }[];
};

export type TermFormSlot = {
  form: { id: string; name: string } | null;
  // Keyed by user id: that person's latest response this term.
  responses: Record<string, TermFormResponse>;
};

export type DomainTermForms = Record<TermFormRole, TermFormSlot>;

// Keyed by domain id. Each domain links its own mentee and mentor forms.
export type TermForms = Record<string, DomainTermForms>;

export function emptyDomainTermForms(): DomainTermForms {
  return { mentee: { form: null, responses: {} }, mentor: { form: null, responses: {} } };
}

export function domainTermForms(forms: TermForms, domainId: string): DomainTermForms {
  return forms[domainId] ?? emptyDomainTermForms();
}

// Only the newest response per person counts, so a resubmission replaces the
// earlier one. Expects submissions newest first.
export function latestPerUser<T extends { userId: string | null }>(
  submissions: T[],
): (T & { userId: string })[] {
  const seen = new Set<string>();
  const out: (T & { userId: string })[] = [];
  for (const s of submissions) {
    if (!s.userId || seen.has(s.userId)) continue;
    seen.add(s.userId);
    out.push(s as T & { userId: string });
  }
  return out;
}
