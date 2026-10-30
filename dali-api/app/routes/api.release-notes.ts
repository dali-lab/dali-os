import type { Route } from "./+types/api.release-notes";
import {
  loadRecapWeeksPage,
  loadReleaseNotesPage,
  requireReleaseNoteViewer,
} from "~/lib/release-notes.server";

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireReleaseNoteViewer(request);
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  if (params.get("view") === "recaps") {
    return Response.json(await loadRecapWeeksPage(viewer, cursor));
  }
  return Response.json(await loadReleaseNotesPage(viewer, { area: params.get("area"), cursor }));
}
