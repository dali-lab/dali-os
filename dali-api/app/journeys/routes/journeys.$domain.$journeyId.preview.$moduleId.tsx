import { redirect } from "react-router";
import type { Route } from "./+types/journeys.$domain.$journeyId.preview.$moduleId";
import { findDomain, loadPreviewJourney, requireJourneyViewer, toDomain } from "~/journeys/lib/journeys.server";
import { getModule } from "~/journeys/lib/journey";
import { editPath, JOURNEYS_HOME, previewPath } from "~/journeys/lib/paths";

export { default, meta, handle } from "./journeys.$domain.$journeyId.$moduleId";

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw redirect(JOURNEYS_HOME);
  const slug = toDomain(domain).slug;
  const found = await loadPreviewJourney(viewer, domain.id, params.journeyId);
  if (!found) throw redirect(editPath(slug, params.journeyId));
  const mod = getModule(found.journey, params.moduleId);
  if (!mod) throw redirect(previewPath(slug, found.journey.id));
  return { domain: toDomain(domain), ...found, module: mod, submission: null };
}
