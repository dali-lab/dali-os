import type { Route } from "./+types/users.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";


export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // users can only access their own data
  if (auth.user.sub !== params.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return Response.json(user);
}
