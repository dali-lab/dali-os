import { redirect } from "react-router";
import type { Route } from "./+types/admin.people";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { AdminClusterHub } from "~/admin/adminPills";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "People & Access · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return null;
}

export default function AdminPeopleHub() {
  return <AdminClusterHub clusterKey="people" />;
}
