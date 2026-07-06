import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/partners";
import { requireAuth } from "~/lib/auth";
import { canViewStaffing } from "~/lib/roles";
import { ComingSoon } from "~/components/ComingSoon";
import { AreaPillNav } from "~/components/AreaPillNav";

export const meta: Route.MetaFunction = () => [{ title: "Partners · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return { canSeeApplications: await canViewStaffing(auth.user.sub) };
}

export default function PartnersOrganizations() {
  const { canSeeApplications } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={[
          { label: "Organizations", to: "/partners", active: true },
          ...(canSeeApplications
            ? [{ label: "Applications", to: "/partners/applications" }]
            : []),
        ]}
      />
      <ComingSoon
        title="Organizations"
        description="Partner companies and the projects they're working with."
      />
    </div>
  );
}
