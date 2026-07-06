import type { Route } from "./+types/api.waitlist";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listActiveWaitlistEntries } from "~/hiring/lib/waitlist.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cycleId = url.searchParams.get("cycleId") ?? undefined;

  const entries = await listActiveWaitlistEntries({ cycleId });
  return Response.json({ entries });
}
