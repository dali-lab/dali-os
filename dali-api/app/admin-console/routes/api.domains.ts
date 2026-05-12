import type { Route } from "./+types/api.domains";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const CreateDomainSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const [hl, dl, admin] = await Promise.all([
    isHiringLead(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hl && !dl && !admin)
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const domains = await prisma.domain.findMany({
    orderBy: { name: "asc" },
    include: {
      domainLeadAssignments: {
        include: { member: { include: { user: true } } },
      },
      _count: {
        select: {
          challengeVersions: true,
          applicationCycles: true,
          domainLeadAssignments: true,
          cycleReviewers: true,
          cycleInterviewers: true,
          delibsSessions: true,
        },
      },
    },
  });

  return withAuth(auth, withCors(request, Response.json(domains)));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  if (request.method !== "POST") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const body = await parseJson(request, CreateDomainSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));
  const { name } = body;

  const domain = await prisma.domain.create({ data: { name } });
  return withAuth(auth, withCors(request, Response.json(domain, { status: 201 })));
}
