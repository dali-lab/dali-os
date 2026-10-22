import type { Route } from "./+types/api.notebooks.$id";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { parseJson } from "~/lib/validate";
import {
  addToNotebook,
  createBlankNote,
  dissolveNotebook,
  getNotebook,
  mergeNotebooks,
  notebookErrorResponse,
  setNotebookTemplate,
  trashNotebook,
} from "~/lib/notebooks.server";

// GET  /api/notebooks/:id — the notebook with its tabs.
// POST /api/notebooks/:id — { intent: "new-note" | "set-template" | "add-page" | "merge-into" | "dissolve" | "trash", ... }

const BodySchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("new-note") }),
  z.object({ intent: z.literal("set-template"), templatePageId: z.string().min(1).nullable() }),
  z.object({ intent: z.literal("add-page"), pageId: z.string().min(1) }),
  z.object({ intent: z.literal("merge-into"), targetId: z.string().min(1) }),
  z.object({ intent: z.literal("dissolve") }),
  z.object({ intent: z.literal("trash") }),
]);

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  try {
    return withCors(request, Response.json(await getNotebook(params.id!, gate.auth.user.sub)));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const actorId = gate.auth.user.sub;
  const notebookId = params.id!;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    switch (body.intent) {
      case "new-note":
        return withCors(request, Response.json({ ok: true, ...(await createBlankNote(notebookId, actorId)) }));
      case "set-template":
        await setNotebookTemplate(notebookId, body.templatePageId, actorId);
        return withCors(request, Response.json({ ok: true }));
      case "add-page":
        await addToNotebook(body.pageId, notebookId, actorId);
        return withCors(request, Response.json({ ok: true }));
      case "merge-into": {
        const result = await mergeNotebooks(notebookId, body.targetId, actorId);
        await logAuditEvent({
          action: "notebook.merge",
          userId: actorId,
          targetId: notebookId,
          metadata: { intoNotebookId: body.targetId, moved: result.moved },
          request,
        });
        return withCors(request, Response.json({ ok: true, ...result }));
      }
      case "dissolve": {
        const result = await dissolveNotebook(notebookId, actorId);
        await logAuditEvent({
          action: "notebook.dissolve",
          userId: actorId,
          targetId: notebookId,
          metadata: { moved: result.moved },
          request,
        });
        return withCors(request, Response.json({ ok: true, ...result }));
      }
      case "trash":
        await trashNotebook(notebookId, actorId);
        await logAuditEvent({ action: "notebook.trash", userId: actorId, targetId: notebookId, request });
        return withCors(request, Response.json({ ok: true }));
    }
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
