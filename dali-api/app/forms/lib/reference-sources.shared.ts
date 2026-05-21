// Client-safe metadata for `reference` question data sources: just the keys
// and their human labels, no DB access. The form editor (a client component)
// imports this to populate its source dropdown; the server registry in
// reference-sources.ts holds the actual queries, keyed by the same strings.
// Keeping these in sync is enforced by a `satisfies` check over there.

export const REFERENCE_SOURCE_LABELS = {
  "projects:open-this-term": "Projects — open this term",
  "projects:active": "Projects — all active",
  "domains:active": "Domains — active",
  // Member-scoped: only the domains THIS member is eligible in. Resolved per
  // filling member, so it's empty on the public (unauthenticated) fill path.
  "domains:my-eligibility": "Domains — my eligibility",
} as const;

export type ReferenceSourceKey = keyof typeof REFERENCE_SOURCE_LABELS;

export function isReferenceSourceKey(
  key: string | undefined | null,
): key is ReferenceSourceKey {
  return !!key && key in REFERENCE_SOURCE_LABELS;
}

// For the editor's source dropdown: [{ key, label }] in declaration order.
export function referenceSourceChoices(): { key: ReferenceSourceKey; label: string }[] {
  return Object.entries(REFERENCE_SOURCE_LABELS).map(([key, label]) => ({
    key: key as ReferenceSourceKey,
    label,
  }));
}
