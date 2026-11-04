// /core has no landing page of its own (the Milestones board that used to live
// here was retired): Core members land on Staffing, the area's first page.
// The path itself stays, because it is the Core area's hub path, the
// breadcrumb root, and the target of Core-application invite emails.

import { redirect } from "react-router";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { getOpenCycles } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) {
    // Non-Core members don't get the Core area. If a Lab members (Core) cycle
    // is open and they're eligible to apply, send them to the application (the
    // invite email links here at /core) instead of bouncing them home. The
    // portal offers a choice when several are open.
    const openCore = await getOpenCycles({ applicants: "LabMembers" });
    if (openCore.length > 0 && (await isCoreCycleEligible(auth.user.sub))) {
      return redirect("/core/apply");
    }
    return redirect("/");
  }

  const embed = new URL(request.url).searchParams.has("embed");
  return redirect(embed ? "/core/staffing?embed=1" : "/core/staffing");
}
