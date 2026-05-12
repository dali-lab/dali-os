import { redirect } from "react-router";
import type { Route } from "./+types/projects.list";
import { requireAuth, withAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));
  return withAuth(auth, null);
}

export default function ProjectsList() {
  return (
    <ComingSoon
      title="Projects"
      description="Browse all DALI projects, their partners, and their status."
    />
  );
}
