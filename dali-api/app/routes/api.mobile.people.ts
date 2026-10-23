import type { Route } from "./+types/api.mobile.people";
import { runSearchDirectory } from "~/mcp/tools/search-directory";
import { listMemberSummaries } from "~/lib/mobile-members.server";
import { mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

const MAX_RESULTS = 15;

// GET /api/mobile/people?q= — current-term members matching a name, email,
// netId, domain or lead title (the People page / search_directory match), for
// picking who to invite.
export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return mobileJson({ people: [] });
  const { results } = await runSearchDirectory({ query: q, limit: MAX_RESULTS });
  return mobileJson({ people: await listMemberSummaries(results.map((r) => r.id)) });
}
