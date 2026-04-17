import type { Route } from "./+types/api.members";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const [admin, hiringLead] = await Promise.all([isAdmin(auth.user.sub), isHiringLead(auth.user.sub)]);
  if (!admin && !hiringLead) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

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

  return withCors(request, Response.json(members));
}
