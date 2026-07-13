import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/internal-processes.jobx";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { ComingSoon } from "~/components/ComingSoon";
import { labProcessesPills } from "~/internal-processes/labProcessesPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const meta: Route.MetaFunction = () => [
  { title: "JobX · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  return { isCore: await isCore(auth.user.sub) };
}

export default function InternalProcessesJobX() {
  const { isCore: core } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={labProcessesPills({ isCore: core, active: "jobx" })} />
      <ComingSoon
        title="JobX"
        description="Internal job exchange and role rotation."
      />
    </div>
  );
}
