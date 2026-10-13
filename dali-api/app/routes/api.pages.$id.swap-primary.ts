import type { Route } from "./+types/api.pages.$id.swap-primary";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { swapPrimary } from "~/lib/shortcuts.server";
import { shortcutAction } from "~/lib/shortcut-route.server";

// POST /api/pages/:id/swap-primary: { shortcutId } makes that shortcut's folder
// the page's primary location and leaves a shortcut in the old one.
const BodySchema = z.object({ shortcutId: z.string().min(1) });

export async function action({ request, params }: Route.ActionArgs) {
  return shortcutAction(request, "POST", async (userId) => {
    const body = await parseJson(request, BodySchema);
    if (body instanceof Response) return body;
    const result = await swapPrimary(params.id!, body.shortcutId, userId, request);
    return { ok: true, ...result };
  });
}
