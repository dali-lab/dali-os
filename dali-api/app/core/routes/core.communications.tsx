import { redirect } from "react-router";
import type { Route } from "./+types/core.communications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { CoreClusterHub, coreHandle } from "~/core/coreNav";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = () => [
  { title: "Communications · Core · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub) };
}

export default function CoreCommunicationsHub() {
  return <CoreClusterHub clusterKey="communications" />;
}
