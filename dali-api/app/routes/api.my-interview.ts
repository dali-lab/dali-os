import type { Route } from "./+types/api.my-interview";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Find the most recent active interview for this user
  const interview = await prisma.interview.findFirst({
    where: {
      application: { userId: auth.user.sub },
      status: { in: ["Scheduled", "NeedsReassignment"] },
    },
    include: {
      assignments: {
        where: { status: "Active" },
      },
    },
    orderBy: { startTime: "desc" },
  });

  return withCors(request, Response.json(interview));
}
