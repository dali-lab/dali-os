import { redirect } from "react-router";
import { resolveLegacyRedirect } from "~/lib/legacy-redirects";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const hit = resolveLegacyRedirect(url.pathname, url.search);
  if (!hit) throw new Response("Not found", { status: 404 });
  return redirect(hit.to, hit.status);
}
