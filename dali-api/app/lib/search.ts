// Pure, client-safe core for the command-palette search: types, ranking, URL
// building, and the hiring-visibility rule. No prisma/db imports so it loads in
// the browser bundle and in unit tests without a generated client. The DB
// queries live in search.server.ts.

export type SearchResultType =
  | "person"
  | "group"
  | "project"
  | "education"
  | "partner"
  | "document"
  | "application"
  | "form"
  | "challenge"
  | "rubric"
  | "emailTemplate"
  | "confidentialityAgreement"
  | "partnerApplication"
  | "cycle"
  | "guide"
  | "helpArticle";

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

// Page guides ("Docs") are help overlays opened with ?doc=1 on their host
// route, not standalone pages — so the palette only surfaces the ones with a
// canonical landing page. Per-instance guides (the document editor, a specific
// form, a project's Drive) share one guide across many URLs with no single
// place to open it, so they're deliberately left out. This is the client-safe
// source of truth for the searchable set: a stable pageKey → where it opens.
export interface GuidePage {
  /** PageDoc.pageKey the host route declares via handle.docKey. */
  pageKey: string;
  /** App-relative host route the guide opens over (may already carry a query). */
  path: string;
  /** Fallback label used before a guide has an authored PageDoc row. */
  title: string;
  /** Extra synonyms so a guide is findable by topic, not just its title. */
  keywords?: string[];
}

export const GUIDE_PAGES: GuidePage[] = [
  { pageKey: "calendar", path: "/calendar", title: "Calendar", keywords: ["schedule", "availability", "meetings", "events"] },
  { pageKey: "projects.hub", path: "/projects", title: "Projects", keywords: ["tasks", "board", "sprints"] },
  { pageKey: "projects.staffing", path: "/projects/staffing", title: "Staffing", keywords: ["assign", "roster", "preferences"] },
  { pageKey: "mentorship.hub", path: "/mentorship", title: "Mentorship", keywords: ["mentor", "mentee"] },
  { pageKey: "drive.root", path: "/drive", title: "Drive", keywords: ["files", "documents", "folders"] },
  { pageKey: "drive.mine", path: "/drive?scope=mine", title: "My Drive", keywords: ["files", "personal"] },
  { pageKey: "drive.lab", path: "/drive?scope=lab", title: "Lab-wide Drive", keywords: ["files", "shared"] },
  { pageKey: "drive.core", path: "/drive?scope=core", title: "Core Drive", keywords: ["files"] },
  { pageKey: "drive.hiring", path: "/drive?scope=hiring", title: "Hiring Drive", keywords: ["files", "recruiting"] },
  { pageKey: "drive.templates", path: "/drive/templates", title: "Templates", keywords: ["gallery"] },
];

const GUIDE_PATH_BY_KEY = new Map(GUIDE_PAGES.map((g) => [g.pageKey, g.path]));

// Canonical detail URLs. Centralized so the route-param gotchas live in one
// place: members key on User.id, education on :offeringId, partners on :orgId,
// applications on the DomainApplication id.
export const buildUrl: Record<SearchResultType, (id: string) => string> = {
  person: (id) => `/members/${id}`,
  // The groups page has no per-group deep link; land on the list (client filter).
  group: () => `/members/groups`,
  project: (id) => `/projects/${id}`,
  education: (id) => `/education/${id}`,
  partner: (id) => `/partners/${id}`,
  document: (id) => `/documents/${id}`,
  application: (id) => `/hiring/applications/${id}`,
  form: (id) => `/forms/edit/${id}`,
  challenge: (id) => `/hiring/challenges/${id}`,
  rubric: (id) => `/hiring/rubrics/${id}`,
  // /hiring/emails/:id just redirects here — link straight to the canonical page.
  emailTemplate: (id) => `/admin/email-templates/${id}`,
  confidentialityAgreement: (id) => `/hiring/confidentiality-agreements/${id}`,
  partnerApplication: (id) => `/partners/applications/${id}`,
  cycle: (id) => `/hiring/lead/cycle/${id}`,
  // Guides open as a ?doc=1 overlay on their host route (see GUIDE_PAGES); the
  // id is the pageKey. Unknown keys fall back home rather than to a dead URL.
  guide: (pageKey) => {
    const path = GUIDE_PATH_BY_KEY.get(pageKey) ?? "/";
    return path.includes("?") ? `${path}&doc=1` : `${path}?doc=1`;
  },
  // Help-center articles are real pages; the id is the slug (see HELP_ARTICLES).
  helpArticle: (slug) => `/help/${slug}`,
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
