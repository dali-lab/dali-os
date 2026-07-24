// GET /api/upload/raw?key=uploads/doc-images/...
// 302-redirects to a fresh presigned S3 read URL. Sibling of /api/upload/url
// (which returns JSON): this shape is directly usable as an <img src> or link
// href inside long-lived content (page-body images), where embedding a bare
// presigned URL would break once it expires. Session-authed — same access
// breadth as /api/upload/url.

import { requireAuth } from "~/lib/auth";
import { getDownloadUrl } from "~/lib/s3";

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !key.startsWith("uploads/")) {
    return Response.json({ error: "key must be an uploads/ object key" }, { status: 400 });
  }

  const url = await getDownloadUrl(key);
  return Response.redirect(url, 302);
}
