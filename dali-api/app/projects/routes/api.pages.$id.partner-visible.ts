import type { Route } from "./+types/api.pages.$id.partner-visible";
import { handlePageVisibility } from "~/projects/lib/page-visibility.server";

// POST /api/pages/:id/partner-visible — toggle a project page's partner
// sharing. Body: { partnerVisible: boolean }. Team-editable (same gate as
// the other document APIs): the team curates what its partner sees.

export async function action({ request, params }: Route.ActionArgs) {
  return handlePageVisibility(request, params.id!, "partnerVisible");
}
