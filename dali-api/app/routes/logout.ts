import type { Route } from "./+types/logout";
import { clearTokenCookies, parseRefreshToken } from "~/lib/cookies";
import { revokeToken } from "~/lib/oauth";

export async function loader({ request }: Route.LoaderArgs) {
  const rt = parseRefreshToken(request);
  if (rt) {
    try {
      await revokeToken(rt);
    } catch {
      // swallow: a stale or invalid cookie should not block logout
    }
  }

  const headers = new Headers();
  clearTokenCookies(headers);
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
