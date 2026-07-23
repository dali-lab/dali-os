import type { Route } from "./+types/api.projects.$id.tasks.archive";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  archiveIdleTasks,
  resolveArchiveAfterDays,
} from "~/jobs/task-auto-archive.server";

// POST /api/projects/:id/tasks/archive
//
// Runs the same idle Done/Cancelled sweep as the weekly task-auto-archive
// job, scoped to this project. Lets board managers archive without waiting
// for the next scheduled tick.

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

  const archiveAfterDays = await resolveArchiveAfterDays();
  const count = await archiveIdleTasks({
    now: new Date(),
    archiveAfterDays,
    projectId: params.id!,
  });

  return withCors(
    request,
    Response.json({ archived: count, archiveAfterDays }),
  );
}
