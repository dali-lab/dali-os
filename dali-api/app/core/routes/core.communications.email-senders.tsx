// Legacy redirect: Email Senders is email-transport infrastructure and now
// lives in Admin ▸ System & Insights, not Core Communications. This
// pre-existing /core URL bounces to the canonical /admin one so old links keep
// working. (It was briefly canonical under the retired nav-regroup flag.)
import { redirect } from "react-router";
import type { Route } from "./+types/core.communications.email-senders";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  return redirect("/admin/email-senders");
}

export default function CoreEmailSendersRedirect() {
  return null;
}
