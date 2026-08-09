// Client-safe metadata for `reference` question data sources: just the keys
// and their human labels, no DB access. The form editor (a client component)
// imports this to populate its source dropdown; the server registry in
// reference-sources.ts holds the actual queries, keyed by the same strings.
// Keeping these in sync is enforced by a `satisfies` check over there.

export const REFERENCE_SOURCE_LABELS = {
  "projects:open-this-term": "Projects — open this term",
  "projects:active": "Projects — all active",
  // Projects whose term set includes a specific term chosen by the form
  // author (stored on the question as `data.referenceTermId`). Unlike
  // `open-this-term`, the term is fixed at authoring time rather than
  // resolved to the current term at fill time.
  "projects:active-in-term": "Projects — active in a chosen term",
  "domains:active": "Domains — active",
  // Member-scoped: only the domains THIS member is eligible in. Resolved per
  // filling member, so it's empty on the public (unauthenticated) fill path.
  "domains:my-eligibility": "Domains — my eligibility",
} as const;

export type ReferenceSourceKey = keyof typeof REFERENCE_SOURCE_LABELS;

// Extra context a `projects:*` option carries so the fill UI can render it as
// a card instead of a bare title — a member picking a project sees what
// they're picking. Only `projects:*` sources populate this; `domains:*`
// options stay plain and render as a <select>.
//
// `challenges` and `sowPageId` are per-(project, term), so each source
// resolves them for the term its options are scoped to (the chosen term, the
// current term, or — for the term-less `projects:active` — the project's
// latest term). Both are omitted/empty when that term has nothing recorded.
export type ProjectOptionCard = {
  description: string | null;
  /** Ready-to-use `<img src>` (already presigned if it was a private upload), or null. */
  imageUrl: string | null;
  /** Names of currently-linked partner orgs (ended partnerships excluded). */
  partners: string[];
  /** This term's per-domain challenge text, alphabetical by domain. */
  challenges: { domain: string; scope: string }[];
  /** Page id of the term's Statement of Work, if one is set. */
  sowPageId: string | null;
};

export type ReferenceOption = {
  value: string;
  label: string;
  card?: ProjectOptionCard;
};

export function isReferenceSourceKey(
  key: string | undefined | null,
): key is ReferenceSourceKey {
  return !!key && key in REFERENCE_SOURCE_LABELS;
}

// Sources whose options depend on a term the form author picks, stored on the
// question as `data.referenceTermId`. The editor shows a term picker for these
// and the server loader filters by that term.
const TERM_SCOPED_SOURCES = new Set<ReferenceSourceKey>([
  "projects:active-in-term",
]);

export function referenceSourceNeedsTerm(
  key: string | undefined | null,
): boolean {
  return isReferenceSourceKey(key) && TERM_SCOPED_SOURCES.has(key);
}

// For the editor's source dropdown: [{ key, label }] in declaration order.
export function referenceSourceChoices(): { key: ReferenceSourceKey; label: string }[] {
  return Object.entries(REFERENCE_SOURCE_LABELS).map(([key, label]) => ({
    key: key as ReferenceSourceKey,
    label,
  }));
}
