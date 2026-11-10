import type { Route } from "./+types/journeys.reviews.more";
import { requireJourneyViewer } from "~/journeys/lib/journeys.server";
import { listReviewedPage } from "~/journeys/lib/studio.server";

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  return Response.json(await listReviewedPage(viewer, new URL(request.url).searchParams.get("cursor")));
}
