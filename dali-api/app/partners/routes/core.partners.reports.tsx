// Placeholder landing for /core/partners/reports. The funnel/cycle-time/
// revenue reporting itself (spec §12) is a separate build; this just gives
// the nav tab a real destination.

import { redirect } from "react-router";
import type { Route } from "./+types/core.partners.reports";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { PartnerCrmNav } from "../components/PartnerCrmNav";

export const handle = { ...coreHandle("partners"), areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner reports · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return null;
}

export default function PartnerReports() {
  return (
    <div className="flex flex-col gap-4">
      <PartnerCrmNav />
      <header>
        <h1 className="font-heading text-foreground text-4xl font-medium">Reports</h1>
      </header>
      <p className="text-sm text-muted-foreground">Reports arrive with the next step.</p>
    </div>
  );
}
