import { redirect } from "react-router";
import { requireAuth, withAuth } from "~/lib/auth";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));
  return withAuth(auth, redirect("/hiring/reviewer"));
}
