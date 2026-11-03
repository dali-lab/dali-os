// Row shapes, CSV shaping, sorting and filtering for the Directory. Client-safe:
// the page imports these in the browser, so queries live in
// partner-directory.server.ts.
//
// The Directory is one list of partner records: organizations, individual
// partners (orgs with isIndividual), and people (contacts). A contact whose
// membership is an individual org is that org's row already, so it doesn't get
// a second row.

import type { PartnerOrgType } from "~/generated/prisma/enums";
import {
  matchesFilters,
  type ColumnFilter,
  type FilterCells,
} from "~/projects/lib/submission-filters";
import type { PartnerRelationshipStatus } from "./partner-org";

// The row's link stretches over it, so the row must contain that overlay. macOS
// WKWebView (the desktop app) ignores `relative` on a <tr>: without the
// transform every overlay escapes the row and the last row takes all clicks.
export const DIRECTORY_ROW_CLASS =
  "group relative [transform:translate(0)] border-t border-os-container/70 transition-colors hover:bg-os-card-hover";

// Source shapes the server listers return; buildDirectoryRows merges them.

export type PartnerOrgDirectoryRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  isIndividual: boolean;
  type: PartnerOrgType | null;
  status: PartnerRelationshipStatus;
  memberCount: number;
  activeProjectCount: number;
  totalProjectCount: number;
  lastActivityAt: string | null;
};

export type PartnerContactDirectoryRow = {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  affiliation: string | null;
  orgs: { id: string; name: string }[];
  applicationCount: number;
  lastActivityAt: string | null;
};

export type DirectoryRowKind = "org" | "individual" | "person";

export const DIRECTORY_KIND_LABELS: Record<DirectoryRowKind, string> = {
  org: "Organization",
  individual: "Individual",
  person: "Person",
};

export const DIRECTORY_KIND_OPTIONS = ["Organization", "Individual", "Person"] as const;

export type PartnerDirectoryRow = {
  kind: DirectoryRowKind;
  /** PartnerOrg id for org/individual rows, PartnerContact id for person rows. */
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  website: string | null;
  logoUrl: string | null;
  type: PartnerOrgType | null;
  /** Relationship status; null on person rows (the org holds the relationship). */
  status: PartnerRelationshipStatus | null;
  /** For person rows, the orgs they belong to. */
  orgNames: string[];
  memberCount: number | null;
  activeProjectCount: number | null;
  totalProjectCount: number | null;
  applicationCount: number | null;
  lastActivityAt: string | null;
};

export function directoryRowHref(row: Pick<PartnerDirectoryRow, "kind" | "id">): string {
  return row.kind === "person"
    ? `/core/partners/contacts/${row.id}`
    : `/core/partners/orgs/${row.id}`;
}

export function buildDirectoryRows(
  orgs: PartnerOrgDirectoryRow[],
  contacts: PartnerContactDirectoryRow[],
): PartnerDirectoryRow[] {
  const individualOrgIds = new Set(orgs.filter((o) => o.isIndividual).map((o) => o.id));
  // An individual org's identity (email, title) lives on its mirror contact.
  const contactByIndividualOrgId = new Map<string, PartnerContactDirectoryRow>();
  for (const c of contacts) {
    for (const o of c.orgs) {
      if (individualOrgIds.has(o.id) && !contactByIndividualOrgId.has(o.id)) {
        contactByIndividualOrgId.set(o.id, c);
      }
    }
  }

  const orgRows: PartnerDirectoryRow[] = orgs.map((o) => {
    const mirror = o.isIndividual ? contactByIndividualOrgId.get(o.id) : undefined;
    return {
      kind: o.isIndividual ? ("individual" as const) : ("org" as const),
      id: o.id,
      name: o.name,
      email: mirror?.email ?? null,
      title: mirror?.title ?? null,
      website: o.website,
      logoUrl: o.logoUrl,
      type: o.type,
      status: o.status,
      orgNames: [],
      memberCount: o.memberCount,
      activeProjectCount: o.activeProjectCount,
      totalProjectCount: o.totalProjectCount,
      applicationCount: mirror?.applicationCount ?? null,
      lastActivityAt: o.lastActivityAt,
    };
  });

  const personRows: PartnerDirectoryRow[] = contacts
    .filter((c) => !c.orgs.some((o) => individualOrgIds.has(o.id)))
    .map((c) => ({
      kind: "person" as const,
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title,
      website: null,
      logoUrl: null,
      type: null,
      status: null,
      orgNames: c.orgs.map((o) => o.name),
      memberCount: null,
      activeProjectCount: null,
      totalProjectCount: null,
      applicationCount: c.applicationCount,
      lastActivityAt: c.lastActivityAt,
    }));

  return [...orgRows, ...personRows];
}

// ─── Filtering ──────────────────────────────────────────────────────────────
// The Directory filters with the shared ColumnFilters builder. Type and status
// cells carry the raw enum values (the columns' optionLabel renders them); an
// org row carries its own name in the `org` cell so filtering
// Organization → Acme shows Acme together with its people.

export const DIRECTORY_FILTER_KEYS = ["kind", "type", "status", "org"] as const;

export function directoryRowCells(row: PartnerDirectoryRow): FilterCells {
  return {
    kind: DIRECTORY_KIND_LABELS[row.kind],
    type: row.type ?? [],
    status: row.status ?? [],
    org: row.kind === "person" ? row.orgNames : row.kind === "org" ? [row.name] : [],
  };
}

export function filterDirectoryRows(
  rows: PartnerDirectoryRow[],
  query: string,
  filters: readonly ColumnFilter[] = [],
): PartnerDirectoryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchesFilters(directoryRowCells(r), filters)) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q) ||
      (r.title ?? "").toLowerCase().includes(q) ||
      r.orgNames.some((n) => n.toLowerCase().includes(q))
    );
  });
}

export function directoryExportHref(query: string, filters: readonly ColumnFilter[]): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  for (const f of filters) {
    if (!(DIRECTORY_FILTER_KEYS as readonly string[]).includes(f.columnKey)) continue;
    for (const v of f.values) params.append(f.columnKey, v);
  }
  const qs = params.toString();
  return `/api/partner-directory.csv${qs ? `?${qs}` : ""}`;
}

export function directoryFiltersFromParams(params: URLSearchParams): ColumnFilter[] {
  return DIRECTORY_FILTER_KEYS.map((key) => ({
    columnKey: key,
    values: params.getAll(key),
  })).filter((f) => f.values.length > 0);
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export function partnerDirectoryCsvRows(rows: PartnerDirectoryRow[]): (string | number)[][] {
  return [
    [
      "Name",
      "Kind",
      "Type",
      "Email",
      "Title",
      "Website",
      "Organizations",
      "Status",
      "People",
      "Active projects",
      "Total projects",
      "Applications",
      "Last activity",
    ],
    ...rows.map((r) => [
      r.name,
      DIRECTORY_KIND_LABELS[r.kind],
      r.type ?? "",
      r.email ?? "",
      r.title ?? "",
      r.website ?? "",
      r.orgNames.join("; "),
      r.status ?? "",
      r.memberCount ?? "",
      r.activeProjectCount ?? "",
      r.totalProjectCount ?? "",
      r.applicationCount ?? "",
      r.lastActivityAt ?? "",
    ]),
  ];
}

// ─── Sorting ────────────────────────────────────────────────────────────────

export type DirectorySortKey = "name" | "activity";
export type DirectorySortDir = "asc" | "desc";
export type DirectorySort = { key: DirectorySortKey; dir: DirectorySortDir };

export const DEFAULT_DIRECTORY_SORT: DirectorySort = { key: "activity", dir: "desc" };

export function isDirectorySort(value: unknown): value is DirectorySort {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.key === "name" || v.key === "activity") && (v.dir === "asc" || v.dir === "desc");
}

export function nextDirectorySort(current: DirectorySort, key: DirectorySortKey): DirectorySort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

type Sortable = { name: string; lastActivityAt: string | null };

export function sortDirectoryRows<T extends Sortable>(rows: T[], sort: DirectorySort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "name") return sign * a.name.localeCompare(b.name);
    if (a.lastActivityAt === b.lastActivityAt) return a.name.localeCompare(b.name);
    if (a.lastActivityAt === null) return 1;
    if (b.lastActivityAt === null) return -1;
    return sign * (Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt));
  });
}

export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
