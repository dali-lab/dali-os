import type { Route } from "./+types/users.$id";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";


export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // users can only access their own data
  if (auth.user.sub !== params.id) {
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
  });

  if (!user) {
    return withAuth(auth, withCors(request, Response.json({ error: "User not found" }, { status: 404 })));
  }

  return withAuth(auth, withCors(request, Response.json(user)));
}
