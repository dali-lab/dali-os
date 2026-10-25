import { prisma } from "~/lib/db";
import { fullName, termCodeLabel } from "~/lib/display";
import { currentTerm, isAdminViaEnv } from "~/lib/roles";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { isLevel } from "~/lib/level";
import { DOMAIN_USAGE_COUNT_SELECT, describeDomainUsage } from "~/admin/routes/api.domains.$domainId";
import { accessOf, mergeMemberships, type AccessDomain, type AccessMember } from "~/core/lib/access";

export async function loadAccess(): Promise<{ members: AccessMember[]; domains: AccessDomain[]; term: string | null }> {
  const term = await currentTerm();
  const [users, domains] = await Promise.all([
    prisma.user.findMany({
      where: LAB_MEMBER_WHERE,
      orderBy: MEMBER_LIST_ORDER_BY,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        daliEmail: true,
        photoUrl: true,
        membershipStatus: true,
        daliMember: { select: { id: true } },
        adminMembership: { select: { isStaff: true } },
        // No current term means no one is Core this term.
        coreAssignments: { where: { termId: term?.id ?? "" }, select: { id: true, leadTitle: true } },
        domainLeadAssignmentsAsUser: { select: { id: true, domainId: true, termId: true, term: { select: { code: true } } } },
        domainEligibilities: { select: { id: true, domainId: true, level: true } },
      },
    }),
    prisma.domain.findMany({
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, active: true, isSystem: true, _count: { select: DOMAIN_USAGE_COUNT_SELECT } },
    }),
  ]);

  const photos = new Map(await Promise.all(users.map(async (u) => [u.id, await resolvePhotoUrl(u.photoUrl)] as const)));

  const members = users.map((u): AccessMember => {
    const envAdmin = isAdminViaEnv(u.id);
    const leads = u.domainLeadAssignmentsAsUser;
    return {
      id: u.id,
      name: fullName(u) || u.daliEmail || "Unnamed",
      email: u.daliEmail,
      photoUrl: photos.get(u.id) ?? null,
      isLabMember: u.daliMember !== null,
      isAlumni: u.membershipStatus !== "Active",
      access: accessOf({ isAdmin: envAdmin || u.adminMembership !== null, isStaff: u.adminMembership?.isStaff === true }),
      envAdmin,
      coreTitles: u.coreAssignments.map((a) => ({ id: a.id, title: a.leadTitle })),
      domains: mergeMemberships(
        u.domainEligibilities.flatMap((e) => (isLevel(e.level) ? [{ id: e.id, domainId: e.domainId, level: e.level }] : [])),
        leads.filter((l) => l.termId === term?.id),
      ),
      otherLeads: leads
        .filter((l) => l.termId !== term?.id)
        .map((l) => ({ id: l.id, domainId: l.domainId, term: termCodeLabel(l.term.code) })),
    };
  });

  return {
    members,
    domains: domains.map((d) => ({
      id: d.id,
      name: d.displayName,
      active: d.active,
      isSystem: d.isSystem,
      usage: describeDomainUsage(d._count),
    })),
    term: term ? termCodeLabel(term.code) : null,
  };
}
