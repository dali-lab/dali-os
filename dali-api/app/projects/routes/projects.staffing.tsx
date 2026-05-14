import { redirect } from "react-router";
import type { Route } from "./+types/projects.staffing";
import { requireAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [{ title: "Staffing · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

export default function ProjectsStaffing() {
  return (
    <ComingSoon
      title="Staffing"
      description="Assign people to projects each term and view current allocations."
    />
  );
}
