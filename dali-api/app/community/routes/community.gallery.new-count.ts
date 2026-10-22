import type { Route } from "./+types/community.gallery.new-count";
import { countNewerPosts, requireGalleryViewer } from "~/community/lib/gallery.server";

// GET /community/gallery/new-count?since=<iso> — how many visible posts landed
// after the newest one the reader has, for the feed's "N new posts" pill.
export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireGalleryViewer(request);
  const since = new Date(new URL(request.url).searchParams.get("since") ?? "");
  if (Number.isNaN(since.getTime())) return { count: 0 };
  return { count: await countNewerPosts(viewer, since) };
}
