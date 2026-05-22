import { redirect } from "react-router";
import type { Route } from "./+types/partners";
import { requireAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [{ title: "Organizations · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

export default function PartnersOrganizations() {
  return (
    <ComingSoon
      title="Organizations"
      description="Partner companies and the projects they're working with."
    />
  );
}
