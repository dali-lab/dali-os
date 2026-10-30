import { prisma } from "~/lib/db.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { partnerRelationshipStatus } from "./partner-org";
import type { PartnerContactDirectoryRow, PartnerOrgDirectoryRow } from "./partner-directory";

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
