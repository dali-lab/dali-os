import type { Route } from "./+types/api.shortcuts";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { createShortcut } from "~/lib/shortcuts.server";
import { DestSchema, shortcutAction } from "~/lib/shortcut-route.server";

// POST /api/shortcuts: { targetPageId, dest } puts a shortcut to a page in a folder.
const BodySchema = z.object({ targetPageId: z.string().min(1), dest: DestSchema });

export async function action({ request }: Route.ActionArgs) {
  return shortcutAction(request, "POST", async (userId) => {
    const body = await parseJson(request, BodySchema);
    if (body instanceof Response) return body;
    const result = await createShortcut({ targetPageId: body.targetPageId, dest: body.dest, actorId: userId, request });
    return { ok: true, ...result };
  });
}
