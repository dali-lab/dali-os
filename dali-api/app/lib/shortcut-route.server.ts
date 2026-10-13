import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { ShortcutError } from "~/lib/shortcuts.server";

export const DestSchema = z.object({
  workspaceType: z.enum(["Lab", "Project", "EducationOffering"]),
  workspaceId: z.string().min(1).nullable(),
  parentPageId: z.string().min(1).nullable(),
});

/** Preflight, method, auth and error mapping shared by the shortcut routes. `run` may return a Response (e.g. a validation failure) to send as is. */
export async function shortcutAction(
  request: Request,
  method: "POST" | "DELETE",
  run: (userId: string) => Promise<unknown>,
): Promise<Response> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== method) {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  try {
    const result = await run(auth.user.sub);
    return withCors(request, result instanceof Response ? result : Response.json(result));
  } catch (err) {
    if (err instanceof ShortcutError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }
}
