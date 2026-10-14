import type { Route } from "./+types/api.notebooks";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { createNotebook, notebookErrorResponse } from "~/lib/notebooks.server";
import { listNotebooks } from "~/lib/notebook-listing.server";

// GET  /api/notebooks?q=&projectId=&meetingId=&workspaceType=&workspaceId= — the notebooks the viewer can edit, suggested ones first.
// POST /api/notebooks — create an empty notebook. Placement and the template
// are checked in createNotebook. Rename is the ordinary POST /api/documents/:id.

const BodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  workspaceType: z.enum(["Lab", "Project"]),
  workspaceId: z.string().min(1).nullable().optional(),
  parentPageId: z.string().min(1).nullable().optional(),
  templatePageId: z.string().min(1).nullable().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const params = new URL(request.url).searchParams;
  const workspaceType = params.get("workspaceType");
  const workspaceId = params.get("workspaceId");
  const space =
    workspaceType === "Lab"
      ? { workspaceType: "Lab" as const, workspaceId: null }
      : workspaceType === "Project" && workspaceId
        ? { workspaceType: "Project" as const, workspaceId }
        : undefined;
  const notebooks = await listNotebooks({
    actorId: gate.auth.user.sub,
    space,
    q: params.get("q"),
    projectId: params.get("projectId"),
    meetingId: params.get("meetingId"),
    request,
  });
  return withCors(request, Response.json({ notebooks }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    const notebook = await createNotebook({
      title: body.title,
      workspaceType: body.workspaceType,
      workspaceId: body.workspaceId ?? null,
      parentPageId: body.parentPageId ?? null,
      templatePageId: body.templatePageId ?? null,
      actorId: gate.auth.user.sub,
    });
    return withCors(request, Response.json({ id: notebook.id }));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
