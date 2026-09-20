import { redirect } from "react-router";
import type { Route } from "./+types/partner.set-password";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Set up your account" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  // Flag-ON: finish-setup now happens at /welcome (unified for all doors).
  if (on) return redirect("/welcome?door=partner");
  // Flag-OFF: keep redirecting to partner login.
  return redirect("/partner/login");
}

// This component is never rendered because the loader always redirects.
export default function PartnerSetPassword() {
  return null;
}
