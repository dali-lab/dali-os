import type { Route } from "./+types/api.my-interview";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Find the most recent active interview for this user
  const interview = await prisma.interview.findFirst({
    where: {
      domainApplication: { application: { userId: auth.user.sub } },
      status: "Scheduled",
    },
    include: {
      assignments: {
        where: { status: "Active" },
      },
    },
    orderBy: { startTime: "desc" },
  });

  return withAuth(auth, withCors(request, Response.json(interview)));
}
