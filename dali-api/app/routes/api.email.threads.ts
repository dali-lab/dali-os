import type { Route } from "./+types/api.email.threads";
import { loadMoreThreads } from "~/email/lib/email.server";

// GET /api/email/threads?cursor=… → { threads, errors, next }: the next page of
// the Email tab's message list. Takes the page's own inbox/folder/search
// params plus the `next` cursor from the page before.
export async function loader({ request }: Route.LoaderArgs) {
  return Response.json(await loadMoreThreads(request));
}
