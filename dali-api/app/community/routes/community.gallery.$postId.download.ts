import { redirect } from "react-router";
import type { Route } from "./+types/community.gallery.$postId.download";
import { galleryDownloadUrl, requireGalleryViewer } from "~/community/lib/gallery.server";

// GET /community/gallery/:postId/download — redirects to a link that saves the
// original photo. Same-origin on purpose: <a download> is ignored on an S3 URL.
export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireGalleryViewer(request);
  const url = await galleryDownloadUrl(viewer, params.postId);
  if (!url) throw new Response("Not found", { status: 404 });
  return redirect(url);
}
