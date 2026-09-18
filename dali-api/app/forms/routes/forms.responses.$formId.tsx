import { redirect } from "react-router";
import type { Route } from "./+types/forms.responses.$formId";

// Results live on the editor, per version. This URL is kept so older links
// (notifications, recents, bookmarks) land on the right results view.
export function loader({ request, params }: Route.LoaderArgs) {
  const version = new URL(request.url).searchParams.get("version");
  const qs = new URLSearchParams({ view: "results" });
  if (version) qs.set("version", version);
  return redirect(`/forms/edit/${params.formId}?${qs}`);
}
