import { redirect } from "react-router";
import type { Route } from "./+types/education";
import { requireAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [
  { title: "Education · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

export default function Education() {
  return (
    <ComingSoon
      title="Education"
      description="Run education offerings and sessions, manage applications and submissions, and track attendance."
    />
  );
}
