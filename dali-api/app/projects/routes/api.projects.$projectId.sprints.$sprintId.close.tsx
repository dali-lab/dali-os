import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.sprints.$sprintId.close";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { parseJson } from "~/lib/validate";
import { closeSprint, SprintCloseError } from "~/projects/lib/sprintClose";

const Schema = z.object({
  destination: z.enum(["backlog", "nextSprint"]),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return body;

  try {
    const result = await closeSprint(params.sprintId!, body.destination);
    return Response.json(result);
  } catch (err) {
    if (err instanceof SprintCloseError) {
      return Response.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
}
