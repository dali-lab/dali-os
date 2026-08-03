import { redirect } from "react-router";
import type { Route } from "./+types/admin.people";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { AdminClusterHub, adminHandle } from "~/admin/adminNav";

export const handle = adminHandle("people");

export const meta: Route.MetaFunction = () => [
  { title: "People & Access · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub) };
}

export default function AdminPeopleHub() {
  return <AdminClusterHub clusterKey="people" />;
}
