// Data + CSV shaping for the Directory (spec §7). Shared by the directory
// page itself and the CSV export resource route so the two can't drift.

import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import type { PartnerOrgType } from "~/generated/prisma/enums";
import { partnerRelationshipStatus, type PartnerRelationshipStatus } from "./partner-org";

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

export async function listPartnerOrgRows(now = new Date()): Promise<PartnerOrgDirectoryRow[]> {
  const orgs = await prisma.partnerOrg.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      website: true,
      isIndividual: true,
      type: true,
      // Active members only. Reads `memberships` (account-first), NOT the
      // retired `users`/PartnerUser relation — which no longer gets rows.
      memberships: { where: { endedAt: null }, select: { id: true } },
      projects: {
        select: {
          startedAt: true,
          endedAt: true,
          project: { select: { status: true } },
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return Promise.all(
    orgs.map(async (o) => {
      const lastActivityAt = o.activities[0]?.createdAt ?? null;
      return {
        id: o.id,
        name: o.name,
        // Uploaded logos are stored as S3 keys; presign for display.
        logoUrl: await resolvePhotoUrl(o.logoUrl),
        website: o.website,
        isIndividual: o.isIndividual,
        type: o.type,
        status: partnerRelationshipStatus({
          projectLinks: o.projects.map((p) => ({ endedAt: p.endedAt })),
          lastActivityAt,
          now,
        }),
        memberCount: o.memberships.length,
        activeProjectCount: o.projects.filter(
          (p) =>
            p.project.status !== "Archived" &&
            (p.startedAt === null || p.startedAt <= now) &&
            (p.endedAt === null || p.endedAt > now),
        ).length,
        totalProjectCount: o.projects.length,
        lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      };
    }),
  );
}

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

export async function listPartnerContactRows(): Promise<PartnerContactDirectoryRow[]> {
  const contacts = await prisma.partnerContact.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      title: true,
      affiliation: true,
      memberships: {
        where: { endedAt: null },
        select: { org: { select: { id: true, name: true } } },
      },
      _count: { select: { applications: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    title: c.title,
    affiliation: c.affiliation,
    orgs: c.memberships.map((m) => m.org),
    applicationCount: c._count.applications,
    lastActivityAt: c.activities[0]?.createdAt.toISOString() ?? null,
  }));
}

export function partnerOrgsCsvRows(orgs: PartnerOrgDirectoryRow[]): (string | number)[][] {
  return [
    [
      "Name",
      "Type",
      "Website",
      "Individual",
      "Status",
      "Members",
      "Active projects",
      "Total projects",
      "Last activity",
    ],
    ...orgs.map((o) => [
      o.name,
      o.type ?? "",
      o.website ?? "",
      o.isIndividual ? "Yes" : "No",
      o.status,
      o.memberCount,
      o.activeProjectCount,
      o.totalProjectCount,
      o.lastActivityAt ?? "",
    ]),
  ];
}

export function partnerContactsCsvRows(
  contacts: PartnerContactDirectoryRow[],
): (string | number)[][] {
  return [
    ["Name", "Email", "Title", "Affiliation", "Organizations", "Applications", "Last activity"],
    ...contacts.map((c) => [
      c.name,
      c.email ?? "",
      c.title ?? "",
      c.affiliation ?? "",
      c.orgs.map((o) => o.name).join("; "),
      c.applicationCount,
      c.lastActivityAt ?? "",
    ]),
  ];
}

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

export type OrgDirectoryFilters = {
  query: string;
  type: string;
  status: string;
  includeIndividuals: boolean;
};

export const DEFAULT_ORG_FILTERS: OrgDirectoryFilters = {
  query: "",
  type: "all",
  status: "all",
  includeIndividuals: true,
};

export function filterOrgRows(
  rows: PartnerOrgDirectoryRow[],
  filters: OrgDirectoryFilters,
): PartnerOrgDirectoryRow[] {
  const q = filters.query.trim().toLowerCase();
  return rows.filter((o) => {
    if (q && !o.name.toLowerCase().includes(q)) return false;
    if (filters.type !== "all" && o.type !== filters.type) return false;
    if (filters.status !== "all" && o.status !== filters.status) return false;
    if (!filters.includeIndividuals && o.isIndividual) return false;
    return true;
  });
}

export function filterContactRows(
  rows: PartnerContactDirectoryRow[],
  query: string,
): PartnerContactDirectoryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      c.orgs.some((o) => o.name.toLowerCase().includes(q)),
  );
}

export function activeOrgFilterCount(filters: OrgDirectoryFilters): number {
  return (
    (filters.type !== "all" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.includeIndividuals ? 0 : 1)
  );
}

export function orgFiltersFromParams(params: URLSearchParams): OrgDirectoryFilters {
  return {
    query: params.get("q") ?? "",
    type: params.get("type") ?? "all",
    status: params.get("status") ?? "all",
    includeIndividuals: params.get("individuals") !== "0",
  };
}

export function directoryExportHref(
  view: "orgs" | "contacts",
  query: string,
  filters: Omit<OrgDirectoryFilters, "query">,
): string {
  const params = new URLSearchParams({ view });
  if (query.trim()) params.set("q", query.trim());
  if (view === "orgs") {
    if (filters.type !== "all") params.set("type", filters.type);
    if (filters.status !== "all") params.set("status", filters.status);
    if (!filters.includeIndividuals) params.set("individuals", "0");
  }
  return `/api/partner-directory.csv?${params.toString()}`;
}

export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
