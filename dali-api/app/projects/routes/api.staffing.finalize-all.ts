import type { Route } from "./+types/api.staffing.finalize-all";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { finalizeStaffing } from "../lib/finalize-staffing.server";

// POST /api/staffing/finalize-all
//
// Finalize every board project in a cycle in one pass, with a single shared set
// of automations. The client sends the project ids it's showing as columns (the
// board is the source of truth for what "all projects" means this term), plus
// the selected automations and the promote-mentors toggle.
//
// Body: { cycleId, projectIds: string[], automations: string[], promoteMentors?: boolean }
//
// Projects are finalized sequentially: the Slack/Gmail/GitHub steps hit rate-
// limited external APIs, and running them concurrently across the whole cohort
// invites throttling. Assignments-only (the default) is DB-bound and quick. Each
// project's outcome is returned independently so one failure never aborts the
// rest.

type Body = {
  cycleId: string;
  projectIds: string[];
  automations: string[];
  promoteMentors?: boolean;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.cycleId !== "string") return false;
  if (!Array.isArray(o.projectIds) || o.projectIds.length === 0) return false;
  if (!o.projectIds.every((p) => typeof p === "string")) return false;
  if (!Array.isArray(o.automations)) return false;
  if (!o.automations.every((a) => typeof a === "string")) return false;
  if (o.promoteMentors !== undefined && typeof o.promoteMentors !== "boolean") return false;
  return true;
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  // De-dupe defensively; the board shouldn't send repeats, but a repeated id
  // would just finalize the same project twice (harmless — finalize is
  // idempotent — but wasteful).
  const projectIds = Array.from(new Set(body.projectIds));

  const projects: {
    projectId: string;
    results?: Awaited<ReturnType<typeof finalizeStaffing>>;
    error?: string;
  }[] = [];

  for (const projectId of projectIds) {
    try {
      const result = await finalizeStaffing(
        auth.user.sub,
        {
          cycleId: body.cycleId,
          projectId,
          automations: body.automations,
          promoteMentors: body.promoteMentors,
        },
        request,
      );
      projects.push({ projectId, results: result });
    } catch (err) {
      projects.push({
        projectId,
        error: err instanceof Error ? err.message : "Finalize failed",
      });
    }
  }

  return withCors(request, Response.json({ projects }));
}
