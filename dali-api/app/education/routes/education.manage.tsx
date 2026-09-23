import { redirect } from "react-router";
import type { Route } from "./+types/education.manage";

// The manage list became /education/offerings, which every lab member browses
// (managers additionally see drafts and archived offerings there). This route
// stays so old links, bookmarks and recents keep working; the per-offering
// admin surfaces under /education/manage/* are unchanged.
export async function loader({ request }: Route.LoaderArgs) {
  return redirect(`/education/offerings${new URL(request.url).search}`);
}
