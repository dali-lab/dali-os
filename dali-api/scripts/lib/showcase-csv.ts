// Pure parsing + matching logic for the Notion "Projects Showcase" import.
// Kept free of DB and filesystem imports so it can be unit-tested directly —
// the name matching is the risky part of the migration and deserves tests, not
// a careful read of a 250-line script.

export type ShowcaseRow = Record<string, string>;

export type ShowcaseStatus =
  | "NotStarted"
  | "InProgress"
  | "NeedsReview"
  | "Published"
  | "Archive";

// Notion's Status vocabulary, carried over verbatim. A blank cell means the
// row was never triaged, which is "not started".
const STATUS: Record<string, ShowcaseStatus> = {
  "Not Started": "NotStarted",
  "In Progress": "InProgress",
  "Needs Review": "NeedsReview",
  Published: "Published",
  Archive: "Archive",
};

// Showcase name → DALI OS Project.name, for the rows that differ by more than
// case and punctuation. Every pair here was checked by hand against the 198
// projects in prod; the importer never guesses a fuzzy match on its own,
// because a wrong link silently publishes one project's write-up under
// another's name.
export const ALIAS: Record<string, string> = {
  "ITC - phishing": "ITC - Phishing contest",
  "ByDesign (previously known as Whiteboard)": "Whiteboard",
  "6AM Health": "6AM Health App",
  PineBeetle: "Pine Beetle Prediction Tool",
  Octo: "Octopus Research",
  "ITC Vox": "ITC Vox Daily",
  iPath: "NCI iPath",
  AIPA: "AI Patient Actor",
  "Dalí Museum Exhibit": "Dalí Museum Eye-Tracking Exhibit",
  "Sign Language AR": "Sign Language Learning",
  "ITC - Chosen Name": "ITC - Student Name Chosen Gender",
  "DOC Website": "Dartmouth Outing Club Planning",
  "GiKids Nutritional Videos": "Nutrition Animation",
};

// Case, spacing, punctuation, and accents all vary between the two systems
// ("TheatreVR" vs "Theatre VR", "Dalí" vs "Dali"), and none of that variation
// is meaningful. Strip it before comparing.
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function cell(row: ShowcaseRow, key: string): string {
  return (row[key] ?? "").trim();
}

// Notion joins multi-selects with ", ". Values never contain commas
// themselves, so a plain split is safe.
export function multiSelect(row: ShowcaseRow, key: string): string[] {
  return cell(row, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseStatus(raw: string): ShowcaseStatus {
  return STATUS[raw] ?? "NotStarted";
}

// "Year in DALI" is a plain calendar year. Anything else (blank, or the one
// row carrying a pasted Notion URL) yields null rather than a bogus number.
export function parseYear(raw: string): number | null {
  if (!/^\d{4}$/.test(raw.trim())) return null;
  const year = Number(raw.trim());
  return year >= 1990 && year <= 2100 ? year : null;
}

// Notion stores bare hostnames in some URL cells ("doc.dartmouth.edu/",
// "shapethefuture.dartmouth.edu"). Give them a scheme so they're clickable;
// reject cells holding prose instead of a link ("add link to the D article
// (ask erica)", "Link the launched product or link to download.").
export function parseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/\s/.test(value)) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

export type ShowcaseFields = {
  displayName: string;
  tagline: string | null;
  year: number | null;
  status: ShowcaseStatus;
  partners: string[];
  products: string[];
  sectors: string[];
  techStack: string[];
  appUrl: string | null;
  websiteUrl: string | null;
  blogUrl: string | null;
  pressUrl: string | null;
  /** Notion's relative attachment path; the file itself is not in the export. */
  logoImagePath: string | null;
};

export function toShowcaseFields(row: ShowcaseRow): ShowcaseFields {
  return {
    displayName: cell(row, "Project Name"),
    tagline: cell(row, "Statement") || null,
    year: parseYear(cell(row, "Year in DALI")),
    status: parseStatus(cell(row, "Status")),
    partners: multiSelect(row, "Partner"),
    products: multiSelect(row, "Product"),
    sectors: multiSelect(row, "Sector"),
    techStack: multiSelect(row, "Tech Stack"),
    appUrl: parseUrl(cell(row, "Link to App")),
    websiteUrl: parseUrl(cell(row, "Link to Website")),
    blogUrl: parseUrl(cell(row, "Student Blog")),
    pressUrl: parseUrl(cell(row, "Press")),
    logoImagePath: cell(row, "Logo Image") || null,
  };
}

export type MatchResult =
  | { kind: "exact"; projectId: string; projectName: string }
  | { kind: "alias"; projectId: string; projectName: string }
  | { kind: "create" }
  | { kind: "skip"; reason: string };

// Resolve one showcase row to a Project. Exact-after-normalization first, then
// the hand-checked alias table, then "create". There is deliberately no fuzzy
// fallback.
export function matchProject(
  showcaseName: string,
  projectsByNormalizedName: Map<string, { id: string; name: string }>,
): MatchResult {
  if (!showcaseName) {
    return { kind: "skip", reason: "no Project Name" };
  }

  const direct = projectsByNormalizedName.get(normalizeName(showcaseName));
  if (direct) {
    return { kind: "exact", projectId: direct.id, projectName: direct.name };
  }

  const aliased = ALIAS[showcaseName];
  if (aliased) {
    const target = projectsByNormalizedName.get(normalizeName(aliased));
    if (target) {
      return { kind: "alias", projectId: target.id, projectName: target.name };
    }
    // The alias table names a project that isn't in this database — a typo
    // here, or a renamed project. Never silently fall through to creating a
    // duplicate; that's what the table exists to prevent.
    return {
      kind: "skip",
      reason: `alias target "${aliased}" not found in database`,
    };
  }

  return { kind: "create" };
}
