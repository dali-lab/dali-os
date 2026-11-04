import type { Route } from "./+types/api.attendance.feed";
import { requireAuth, forbidden, isNonMember } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loadAttendanceFeed } from "~/lib/attendance-feed.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (await isNonMember(auth, request)) return forbidden(request);

  const url = new URL(request.url);
  const core = await isCore(auth.user.sub, request);
  return Response.json(
    await loadAttendanceFeed(
      { userId: auth.user.sub, core },
      { q: url.searchParams.get("q") ?? "", cursor: url.searchParams.get("cursor") ?? "" },
    ),
  );
}
