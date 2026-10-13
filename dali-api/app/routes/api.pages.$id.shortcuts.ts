import type { Route } from "./+types/api.pages.$id.shortcuts";
import { placementsOf } from "~/lib/shortcuts.server";
import { shortcutAction } from "~/lib/shortcut-route.server";

// GET /api/pages/:id/shortcuts: where the page lives and the shortcuts to it the viewer can see.
export async function loader({ request, params }: Route.LoaderArgs) {
  return shortcutAction(request, "GET", async (userId) => ({
    ok: true,
    ...(await placementsOf(params.id!, userId, request)),
  }));
}
