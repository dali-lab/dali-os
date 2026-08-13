import { redirect } from "react-router";
import type { Route } from "./+types/admin.communications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { AdminClusterHub, adminHandle } from "~/admin/adminNav";
import { regroupRedirect } from "~/core/lib/regroup-redirect.server";

export const handle = adminHandle("communications");

export const meta: Route.MetaFunction = () => [
  { title: "Communications · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/admin/communications",
    "/core/communications",
  );
  if (regrouped) return regrouped;
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub) };
}

export default function AdminCommunicationsHub() {
  return <AdminClusterHub clusterKey="communications" />;
}
