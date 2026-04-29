import { redirect } from "react-router";
import type { Route } from "./+types/admin-console";

export const meta: Route.MetaFunction = () => [{ title: "Admin console · DALI OS" }];

export async function loader(_args: Route.LoaderArgs) {
  return redirect("/admin-console/members");
}

export default function AdminConsoleRedirect() {
  return null;
}
