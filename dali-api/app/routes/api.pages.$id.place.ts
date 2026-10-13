import type { Route } from "./+types/api.pages.$id.place";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { placePage } from "~/lib/shortcuts.server";
import { DestSchema, shortcutAction } from "~/lib/shortcut-route.server";

// POST /api/pages/:id/place: { destinations, primaryIndex } moves the page to the
// primary destination and leaves a shortcut in each of the others.
const BodySchema = z.object({
  destinations: z.array(DestSchema).min(1).max(20),
  primaryIndex: z.number().int().min(0),
});

export async function action({ request, params }: Route.ActionArgs) {
  return shortcutAction(request, "POST", async (userId) => {
    const body = await parseJson(request, BodySchema);
    if (body instanceof Response) return body;
    const result = await placePage({
      pageId: params.id!,
      destinations: body.destinations,
      primaryIndex: body.primaryIndex,
      actorId: userId,
      request,
    });
    return { ok: true, ...result };
  });
}
