import type { Route } from "./+types/api.members";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin, isHiringLead, isDomainLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const [admin, hiringLead, domainLead] = await Promise.all([isAdmin(auth.user.sub), isHiringLead(auth.user.sub), isDomainLead(auth.user.sub)]);
  if (!admin && !hiringLead && !domainLead) return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const members = await prisma.dALIMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      daliEmail: true,
      firstName: true,
      lastName: true,
      roles: true,
      domainLeadAssignments: { select: { id: true, domain: { select: { id: true, name: true } } } },
    },
  });

  return withAuth(auth, withCors(request, Response.json(members)));
}
