import type { Route } from "./+types/api.link-preview";
import { requireResourceHubViewer } from "~/resource-hub/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { limitLinkPreviews } from "~/lib/link-preview-limit.server";

// POST /api/link-preview — the image, title and description a page advertises, for the Resources component.
export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireResourceHubViewer(request);
  const limited = limitLinkPreviews(request, user.sub);
  if (limited) return limited;
  const form = await request.formData();
  const preview = await fetchLinkPreview(String(form.get("url") ?? ""));
  return Response.json(preview ?? { image: null, title: null, description: null });
}
