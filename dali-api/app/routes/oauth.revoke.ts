import type { Route } from "./+types/oauth.revoke";
import { revokeToken } from "~/lib/oauth";

import { clearTokenCookies, parseRefreshToken } from "~/lib/cookies";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export const loader = preflightLoader;

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // read refresh token from cookie first, fall back to body
  let token: string | undefined = parseRefreshToken(request) ?? undefined;

  // don't strictly need this yet but good to have support if we want to support API access later
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
    await revokeToken(token);
  }

  const res = Response.json({});
  clearTokenCookies(res.headers);
  return withCors(request, res);
}
