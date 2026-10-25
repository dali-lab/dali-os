import { redirect } from "react-router";
import type { Route } from "./+types/journeys.$domain.$journeyId.preview";
import { findDomain, loadPreviewJourney, requireJourneyViewer, toDomain } from "~/journeys/lib/journeys.server";
import { editPath, JOURNEYS_HOME } from "~/journeys/lib/paths";

export { default, meta, handle } from "./journeys.$domain.$journeyId";

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw redirect(JOURNEYS_HOME);
  const found = await loadPreviewJourney(viewer, domain.id, params.journeyId);
  if (!found) throw redirect(editPath(toDomain(domain).slug, params.journeyId));
  return { domain: toDomain(domain), ...found };
}
