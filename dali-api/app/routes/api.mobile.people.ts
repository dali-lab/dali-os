import type { Route } from "./+types/api.mobile.people";
import { searchDirectory } from "~/members/lib/directory-search.server";
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
  const rows = await searchDirectory({ query: q, take: MAX_RESULTS });
  return mobileJson({ people: await listMemberSummaries(rows.map((r) => r.id)) });
}
