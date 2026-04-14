import type { Route } from "./+types/api.members";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const members = await prisma.dALIMember.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });

  return withCors(request, Response.json(members));
}
