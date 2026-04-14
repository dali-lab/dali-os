import type { Route } from "./+types/logout";
import { clearTokenCookies } from "~/lib/cookies";

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  clearTokenCookies(headers);
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
