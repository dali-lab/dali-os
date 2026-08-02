// Pure, client-safe core for the command-palette search: types, ranking, URL
// building, and the hiring-visibility rule. No prisma/db imports so it loads in
// the browser bundle and in unit tests without a generated client. The DB
// queries live in search.server.ts.

export type SearchResultType =
  | "person"
  | "project"
  | "education"
  | "partner"
  | "document"
  | "application"
  | "form"
  | "formFolder"
  | "challenge"
  | "rubric"
  | "emailTemplate"
  | "confidentialityAgreement"
  | "partnerApplication"
  | "cycle";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  /** Resolved avatar URL for `person` results (null → initials fallback). */
  photoUrl?: string | null;
  /** Custom emoji for entity results — project icons and page/document icons
   *  (files fall back to the type icon). Null → the type's default glyph. */
  iconEmoji?: string | null;
}

export const MIN_QUERY_LENGTH = 2;
export const PER_CATEGORY_CAP = 5;

// Canonical detail URLs. Centralized so the route-param gotchas live in one
// place: members key on User.id, education on :offeringId, partners on :orgId,
// applications on the DomainApplication id.
export const buildUrl: Record<SearchResultType, (id: string) => string> = {
  person: (id) => `/members/${id}`,
  project: (id) => `/projects/${id}`,
  education: (id) => `/education/${id}`,
  partner: (id) => `/partners/${id}`,
  document: (id) => `/documents/${id}`,
  application: (id) => `/hiring/applications/${id}`,
  form: (id) => `/forms/edit/${id}`,
  formFolder: (id) => `/forms/${id}`,
  challenge: (id) => `/hiring/challenges/${id}`,
  rubric: (id) => `/hiring/rubrics/${id}`,
  // /hiring/emails/:id just redirects here — link straight to the canonical page.
  emailTemplate: (id) => `/admin/email-templates/${id}`,
  confidentialityAgreement: (id) => `/hiring/confidentiality-agreements/${id}`,
  partnerApplication: (id) => `/partners/applications/${id}`,
  cycle: (id) => `/hiring/lead/cycle/${id}`,
};

// Lower is better; null means no match. exact(0) > prefix(1) > word-start(2) >
// substring(3). Whitespace-trimmed, case-insensitive.
export function matchScore(text: string, query: string): number | null {
  const t = text.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q || !t) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return null;
}

// Best (lowest) score across candidate fields (e.g. name + email).
export function bestScore(fields: string[], query: string): number | null {
  let best: number | null = null;
  for (const f of fields) {
    const s = matchScore(f, query);
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

export interface Rankable {
  result: SearchResult;
  /** Fields to score/rank against (title, and e.g. email for people). */
  text: string[];
}

// Rank matches, tie-break alphabetically by title, cap to PER_CATEGORY_CAP.
export function rankResults(entries: Rankable[], query: string): SearchResult[] {
  return entries
    .map((e) => ({ e, score: bestScore(e.text, query) }))
    .filter((x): x is { e: Rankable; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.e.result.title.localeCompare(b.e.result.title))
    .slice(0, PER_CATEGORY_CAP)
    .map((x) => x.e.result);
}

export type ReviewerRow = { applicationCycleId: string; domainId: string };

// Which hiring applications a user may see, mirroring the LIST route
// (app/hiring/routes/applications.tsx): Core sees every cycle/domain; everyone
// else sees only their assigned (cycle, domain) reviewer pairs. Deliberately
// does NOT grant domain leads blanket access — the list view doesn't either, so
// search never discloses more than that view already would.
export function computeHiringVisibility(
  isCore: boolean,
  reviewerRows: ReviewerRow[],
): { all: true } | { all: false; pairs: ReviewerRow[] } {
  if (isCore) return { all: true };
  return { all: false, pairs: reviewerRows };
}
