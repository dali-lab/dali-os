import type { Route } from "./+types/oauth.revoke";
import { revokeToken } from "~/lib/oauth";

import { clearTokenCookies, parseRefreshToken } from "~/lib/cookies";

export async function action({ request }: Route.ActionArgs) {
  // read refresh token from cookie first, fall back to body
  let token: string | undefined = parseRefreshToken(request) ?? undefined;

  // don't strictly need this yet but good to have support if we want to support API access later
  if (!token) {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
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
  return res;
}
