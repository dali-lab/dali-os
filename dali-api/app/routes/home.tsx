import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return redirect("/reviewer");
}
