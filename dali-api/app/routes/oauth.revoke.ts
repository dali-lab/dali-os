import type { Route } from "./+types/oauth.revoke";
import { revokeSession } from "~/lib/session";
import { clearSessionCookie, parseSessionId } from "~/lib/cookies";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export const loader = preflightLoader;

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // Cookie or Bearer first, then fall back to body `token`.
  let token: string | undefined = parseSessionId(request) ?? undefined;

  if (!token) {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await safeJson<{ token?: string }>(request);
      if (body instanceof Response) return withCors(request, body);
      token = body.token;
    } else {
      const formData = await request.formData();
      token = formData.get("token") as string | undefined;
    }
  }

  if (token) {
    await revokeSession(token);
  }

  const res = Response.json({});
  clearSessionCookie(res.headers);
  return withCors(request, res);
}
