import { redirect } from "react-router";
import type { Route } from "./+types/analytics";

// The pipeline (status pie + drill-down) now lives on the /hiring hub; keep
// old links working, including their ?cycleId/&domain/&status params.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/hiring${url.search}`);
}

export default function AnalyticsRedirect() {
  return null;
}
