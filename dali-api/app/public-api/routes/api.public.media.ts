import type { Route } from "./+types/api.public.media";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { isServableMediaKey } from "../lib/public-media";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";

// GET /api/public/media?key=uploads/... — resolve one public image.
//
// Answers with a redirect to a short-lived presigned S3 URL rather than
// proxying the bytes: dali.website's server-side fetch follows it and streams
// the result on to the browser, so the presigned URL is never exposed and
// dali-api doesn't pay for the transfer twice.
//
// The key is checked against isServableMediaKey — the shared secret must not
// double as a read capability for arbitrary bucket paths.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !isServableMediaKey(key)) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }
  if (!isS3Configured()) {
    return Response.json({ error: "Media storage is not configured" }, { status: 503 });
  }

  const url = await getDownloadUrl(key, { inline: true });
  return Response.redirect(url, 302);
}
