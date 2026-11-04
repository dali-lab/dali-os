import type { Route } from "./+types/api.notebooks.mentorship-pair";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { prisma } from "~/lib/db.server";
import { formatFiledPath, notebookLocationParts } from "~/lib/note-path.server";
import { ensurePairNotebook } from "~/mentorship/lib/pair-notebook.server";
import { findMentorPair } from "~/mentorship/lib/pair-suggestion.server";

// POST /api/notebooks/mentorship-pair — { menteeId }: the notebook for the
// caller's mentorship pair with that mentee this term, made if it does not exist
// yet. Answers with the same shape the notebook picker hands back.

const BodySchema = z.object({ menteeId: z.string().min(1) });

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const actorId = gate.auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const pair = await findMentorPair(actorId, body.menteeId, request);
  if (!pair) return withCors(request, Response.json({ error: "You don't mentor that person this term" }, { status: 404 }));

  const { id } = await ensurePairNotebook({ ...pair, actorId });
  const notebook = await prisma.page.findUniqueOrThrow({
    where: { id },
    select: { id: true, title: true, workspaceType: true, workspaceId: true, parentPageId: true },
  });
  const path = formatFiledPath(await notebookLocationParts(notebook, actorId, request));
  return withCors(request, Response.json({ ...notebook, path }));
}
