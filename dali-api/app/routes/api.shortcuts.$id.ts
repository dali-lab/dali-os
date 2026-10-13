import type { Route } from "./+types/api.shortcuts.$id";
import { deleteShortcut } from "~/lib/shortcuts.server";
import { shortcutAction } from "~/lib/shortcut-route.server";

// DELETE /api/shortcuts/:id removes the shortcut and the share it created, if any.
export async function action({ request, params }: Route.ActionArgs) {
  return shortcutAction(request, "DELETE", async (userId) => {
    await deleteShortcut(params.id!, userId, request);
    return { ok: true };
  });
}
