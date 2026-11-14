import type { Route } from "./+types/api.link-preview";
import { requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";

// POST /api/link-preview — the image, title and description a page advertises, for the Resources component.
export async function action({ request }: Route.ActionArgs) {
  await requireResourceHubViewer(request);
  const form = await request.formData();
  const preview = await fetchLinkPreview(String(form.get("url") ?? ""));
  return Response.json(preview ?? { image: null, title: null, description: null });
}
