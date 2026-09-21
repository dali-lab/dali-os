import { redirect } from "react-router";
import type { Route } from "./+types/analytics";

// The pipeline pie now lives on Applications; keep old links working. Its
// cycle param was ?cycleId=, Applications reads ?cycle=.
export async function loader({ request }: Route.LoaderArgs) {
  const cycleId = new URL(request.url).searchParams.get("cycleId");
  return redirect(
    cycleId ? `/hiring/applications?cycle=${encodeURIComponent(cycleId)}` : "/hiring/applications",
  );
}

export default function AnalyticsRedirect() {
  return null;
}
