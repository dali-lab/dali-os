import { redirect } from "react-router";
import type { Route } from "./+types/internal-processes.jobx";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [
  { title: "JobX · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  return null;
}

export default function InternalProcessesJobX() {
  return (
    <ComingSoon
      title="JobX"
      description="Internal job exchange and role rotation."
    />
  );
}
