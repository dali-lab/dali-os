import type { Route } from "./+types/api.projects.$id.tasks.archive";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { archiveTerminalTasks } from "~/jobs/task-auto-archive.server";

// POST /api/projects/:id/tasks/archive
//
// Immediately archives every live Done/Cancelled task on this project (no
// idle-day threshold). The weekly task-auto-archive job still uses the
// age-gated sweep for lab-wide cleanup.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }

  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;

  const count = await archiveTerminalTasks({
    now: new Date(),
    projectId: params.id!,
  });

  return withCors(request, Response.json({ archived: count }));
}
