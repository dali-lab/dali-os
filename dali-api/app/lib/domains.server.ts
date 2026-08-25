import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

// Domains eligible for a domain hub: "skill domains" — active, not the synthetic
// system domain (CORE), and not an intern program (ERAS/WISP/EEJUST, which are
// cohorts rather than disciplines). This is the single definition of the set the
// Domains index, the hubs, and the Drive "Domains" section all draw from.
export function skillDomainWhere() {
  return { active: true, isSystem: false, isInternProgram: false } as const;
}

export async function listSkillDomains() {
  return prisma.domain.findMany({
    where: skillDomainWhere(),
    orderBy: { displayName: "asc" },
    select: { id: true, code: true, displayName: true, description: true },
  });
}

// Whether one domain row qualifies for a hub (guards the /domains/:id loader).
export function isSkillDomain(d: {
  active: boolean;
  isSystem: boolean;
  isInternProgram: boolean;
}): boolean {
  return d.active && !d.isSystem && !d.isInternProgram;
}

export type DomainLead = {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
};

// Current-term leads of a domain, with display fields for the hub header.
// Deduped by user id. Empty when there's no current term.
export async function currentDomainLeads(
  domainId: string,
  request?: Request,
): Promise<DomainLead[]> {
  const term = await currentTerm(request);
  if (!term) return [];
  const rows = await prisma.domainLeadAssignment.findMany({
    where: { domainId, termId: term.id },
    select: {
      user: {
        select: { id: true, firstName: true, lastName: true, photoUrl: true },
      },
    },
  });
  const seen = new Set<string>();
  const out: DomainLead[] = [];
  for (const r of rows) {
    if (seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    out.push(r.user);
  }
  return out;
}

// Just the current-term lead userIds — the recipient set for Growth request
// notifications (see growth-notify.server.ts).
export async function currentDomainLeadUserIds(
  domainId: string,
  request?: Request,
): Promise<string[]> {
  const leads = await currentDomainLeads(domainId, request);
  return leads.map((l) => l.id);
}
