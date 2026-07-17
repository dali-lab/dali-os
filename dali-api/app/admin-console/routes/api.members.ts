import type { Route } from "./+types/api.members";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin, isCore, isDomainLead, isAdminViaEnv, currentTermMemberWhere } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";

// Phase 2: returns lab members rooted at User. Role shape derives from
// AdminMembership / CoreAssignment / DomainLeadAssignment rows.
//
// ?scope=current restricts to current-term lab members (active CoreAssignment
// or ProjectAssignment for the current term), for pickers that should not
// surface alumni — e.g. hiring reviewer/interviewer assignment. The default
// (no scope param) preserves the all-time member list used by Admin Console
// role management, where alumni still need to appear.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const [admin, hiringLead, domainLead] = await Promise.all([
    isAdmin(auth.user.sub),
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
  ]);
  if (!admin && !hiringLead && !domainLead) return forbidden(request);

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const where =
    scope === "current"
      ? await currentTermMemberWhere()
      : { ...LAB_MEMBER_WHERE };

  const users = await prisma.user.findMany({
    where,
    orderBy: MEMBER_LIST_ORDER_BY,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      adminMembership: { select: { id: true } },
      coreAssignments: { select: { leadTitle: true } },
      domainLeadAssignmentsAsUser: {
        select: {
          id: true,
          termId: true,
          domain: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const members = users.map((u) => {
    const isAdminUser = u.adminMembership !== null || isAdminViaEnv(u.id);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      daliEmail: u.daliEmail,
      isAdmin: isAdminUser,
      isCore: isAdminUser || u.coreAssignments.length > 0,
      coreTitles: u.coreAssignments
        .map((a) => a.leadTitle)
        .filter((t): t is string => !!t),
      domainLeadAssignments: u.domainLeadAssignmentsAsUser.map((a) => ({
        id: a.id,
        domain: { id: a.domain.id, name: a.domain.displayName },
      })),
    };
  });

  return withCors(request, Response.json(members));
}
