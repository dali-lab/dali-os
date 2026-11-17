import type { Route } from "./+types/api.forms.fill.$token.upload";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireAuth } from "~/lib/auth";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import { presignFormUpload } from "~/forms/lib/form-upload.server";

const UploadSchema = z.object({
  key: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200),
  contentLength: z.number().nonnegative().finite().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  const userId = auth.ok ? auth.user.sub : null;

  const limited = checkRateLimit(
    request,
    { max: 30, windowMs: 10 * 60_000 },
    `form-upload:${userId ?? getClientIp(request)}`,
  );
  if (limited) return withCors(request, limited);

  const body = await parseJson(request, UploadSchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    const result = await presignFormUpload({
      token: params.token!,
      userId,
      key: body.key,
      contentType: body.contentType,
      contentLength: body.contentLength,
      request,
    });
    if ("error" in result) {
      return withCors(request, Response.json({ error: result.error }, { status: result.status }));
    }
    return withCors(request, Response.json(result));
  } catch (err) {
    console.error("Form upload presign error:", err);
    return withCors(request, Response.json({ error: "Failed to generate upload URL" }, { status: 500 }));
  }
}
