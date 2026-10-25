import { redirect } from "react-router";
import { Map as MapIcon } from "lucide-react";
import type { Route } from "./+types/journeys";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { loadJourneyTabs, requireJourneyViewer, toDomain } from "~/journeys/lib/journeys.server";
import { domainPath } from "~/journeys/lib/paths";

export const meta: Route.MetaFunction = () => [{ title: "Onboarding · DALI OS" }];

export const handle = { hideBreadcrumbs: true };

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const { defaultDomain } = await loadJourneyTabs(viewer);
  if (defaultDomain) throw redirect(domainPath(toDomain(defaultDomain).slug));
  return null;
}

export default function JourneysIndex() {
  const { pageTitle, panel } = useOsChrome();
  return (
    <div className="flex flex-col gap-6">
      <h1 className={pageTitle}>Onboarding</h1>
      <div className={cn(panel, "p-10 text-center")}>
        <MapIcon className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
        <p className="mt-3 text-os-grey">No onboarding journeys have been published yet.</p>
      </div>
    </div>
  );
}
