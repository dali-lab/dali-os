import { redirect } from "react-router";
import type { Route } from "./+types/login.dartmouth";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Dartmouth sign in" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  // Flag-ON: Dartmouth sign-up/sign-in happens via the unified /signup door.
  if (on) return redirect("/signup?door=dartmouth");
  // Flag-OFF: door only existed when betterauth was on — redirect to login.
  return redirect("/login");
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");
  // Flag-ON: this action should not be reached (loader redirects). Redirect
  // defensively in case a form was submitted before the page reloaded.
  return redirect("/signup?door=dartmouth");
}

// This component is never rendered because the loader always redirects.
// It exists only to satisfy the React Router route convention.
export default function LoginDartmouth() {
  return null;
}
