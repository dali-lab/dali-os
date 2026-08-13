import { redirect } from "react-router";
import type { Route } from "./+types/core.access";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { CoreClusterHub, coreHandle } from "~/core/coreNav";

export const handle = coreHandle("access");

export const meta: Route.MetaFunction = () => [
  { title: "Access & Permissions · Core · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub) };
}

export default function CoreAccessHub() {
  return <CoreClusterHub clusterKey="access" />;
}
