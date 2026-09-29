import { requireAuth } from "~/lib/auth";
import { getObjectBytes } from "~/lib/s3";

const WHITEBOARD_KEY_PREFIX = "uploads/whiteboard-images/";

// GET /api/whiteboard/image?key=uploads/whiteboard-images/...
//
// Streams a whiteboard image's bytes from S3 SAME-ORIGIN. Unlike
// /api/upload/raw (which 302-redirects to a presigned S3 URL), this proxies the
// bytes through our origin on purpose: Excalidraw draws images onto its canvas,
// and a cross-origin image taints the canvas — which would break PNG/SVG export
// and, when the browser loads with crossOrigin, the image itself. Serving from
// our own origin keeps the canvas clean.
//
// Auth-gated like the other upload routes (any signed-in member with the URL —
// the same model as BlockNote doc images). Keys are uuid-named and immutable, so
// the browser may cache aggressively.
export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Whiteboard images only. This route reads the whole object into memory, and
  // Drive / project files can be 100 MB — any other uploads/ key would let a
  // few requests exhaust the machine (#1783).
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !key.startsWith(WHITEBOARD_KEY_PREFIX) || key.includes("..")) {
    return Response.json({ error: "key must be a whiteboard image key" }, { status: 400 });
  }

  try {
    const { body, contentType } = await getObjectBytes(key);
    // Wrap in a fresh Uint8Array<ArrayBuffer>: Node's Buffer<ArrayBufferLike>
    // isn't assignable to the DOM BodyInit type.
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
