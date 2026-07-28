import type { Route } from "./+types/api.pages.$id.public-visible";
import { handlePageVisibility } from "~/projects/lib/page-visibility.server";

// POST /api/pages/:id/public-visible — mark a project page as the project's
// public write-up on dali.website. Body: { publicVisible: boolean }.
// Team-editable, same gate as partner sharing: the team writes its own story.
// Note this only exposes a read-only snapshot through the public API — unlike
// partner sharing, it grants nobody edit access.

export async function action({ request, params }: Route.ActionArgs) {
  return handlePageVisibility(request, params.id!, "publicVisible");
}
