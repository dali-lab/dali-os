import type { Route } from "./+types/api.domains";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const domains = await prisma.domain.findMany({
    orderBy: { name: "asc" },
    include: {
      domainLeadAssignments: {
        include: { member: { include: { user: true } } },
      },
    },
  });

  return withCors(request, Response.json(domains));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isHiringLead(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const { name } = await request.json();
  if (!name?.trim()) {
    return withCors(request, Response.json({ error: "Name is required" }, { status: 400 }));
  }

  const domain = await prisma.domain.create({ data: { name: name.trim() } });
  return withCors(request, Response.json(domain, { status: 201 }));
}
