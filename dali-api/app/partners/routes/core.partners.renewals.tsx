import { redirect } from "react-router";
import type { Route } from "./+types/core.partners.renewals";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { PartnerCrmNav } from "../components/PartnerCrmNav";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner renewals · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("partner-planning", auth.user.sub, roles, request))) {
    return redirect("/core/partners");
  }
  return {};
}

export default function PartnersRenewals() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <PartnerCrmNav />
      </div>
    </div>
  );
}
