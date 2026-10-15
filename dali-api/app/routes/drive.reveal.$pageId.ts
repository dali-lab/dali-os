import { redirect } from "react-router";
import type { Route } from "./+types/drive.reveal.$pageId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { driveRevealHref } from "~/lib/drive-reveal.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const href = await driveRevealHref(params.pageId, auth.user.sub, request);
  if (!href) throw new Response("Not found", { status: 404 });
  return redirect(href);
}
