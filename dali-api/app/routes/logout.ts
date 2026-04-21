import type { Route } from "./+types/logout";
import { auth } from "~/lib/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const res = await auth.api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers(res.headers);
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
