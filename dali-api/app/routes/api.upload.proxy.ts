// GET /api/upload/proxy?key=uploads/... — streams the S3 object bytes
// SAME-ORIGIN (unlike /api/upload/raw, which 302-redirects to a cross-origin
// presigned URL). The image crop tool draws the image onto a <canvas>; a
// cross-origin redirect would taint the canvas and block toBlob(). Fetching
// the object through the app server keeps it same-origin. Session-authed with
// the same breadth as /api/upload/raw.

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
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
