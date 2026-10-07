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
