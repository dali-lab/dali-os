import type { Route } from "./+types/api.members";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isHiringLead, isDomainLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// Phase 2: returns lab members rooted at User. Role shape derives from
// AdminMembership / CoreAssignment / DomainLeadAssignment rows.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const [admin, hiringLead, domainLead] = await Promise.all([
    isAdmin(auth.user.sub),
    isHiringLead(auth.user.sub),
    isDomainLead(auth.user.sub),
  ]);
  if (!admin && !hiringLead && !domainLead) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const users = await prisma.user.findMany({
    where: { daliMember: { isNot: null } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      adminMembership: { select: { id: true } },
      coreAssignments: { select: { id: true, termId: true, leadTitle: true } },
      domainLeadAssignmentsAsUser: {
        select: {
          id: true,
          termId: true,
          domain: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const members = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    daliEmail: u.daliEmail,
    isAdmin: u.adminMembership !== null,
    isCore: u.coreAssignments.length > 0,
    coreTitles: u.coreAssignments
      .map((a) => a.leadTitle)
      .filter((t): t is string => !!t),
    domainLeadAssignments: u.domainLeadAssignmentsAsUser.map((a) => ({
      id: a.id,
      domain: { id: a.domain.id, name: a.domain.displayName },
    })),
  }));

  return withCors(request, Response.json(members));
}
