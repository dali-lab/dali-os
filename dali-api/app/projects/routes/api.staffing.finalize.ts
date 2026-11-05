import type { Route } from "./+types/api.staffing.finalize";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  finalizeStaffing,
  FinalizeInputError,
  FinalizeNotFoundError,
  type FinalizeStaffingBody,
} from "../lib/finalize-staffing.server";

function isBody(x: unknown): x is FinalizeStaffingBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.projectId === "string" &&
    Array.isArray(o.automations) &&
    o.automations.every((a) => typeof a === "string") &&
    (o.slackChannel === undefined || typeof o.slackChannel === "string") &&
    (o.githubTeamSlug === undefined || typeof o.githubTeamSlug === "string") &&
    (o.saveFieldsOnly === undefined || typeof o.saveFieldsOnly === "boolean") &&
    (o.promoteMentors === undefined || typeof o.promoteMentors === "boolean")
  );
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

  try {
    return withCors(request, Response.json(await finalizeStaffing(auth.user.sub, body, request)));
  } catch (err) {
    if (err instanceof FinalizeNotFoundError) {
      return withCors(request, Response.json({ error: err.message }, { status: 404 }));
    }
    if (err instanceof FinalizeInputError) {
      return withCors(request, Response.json({ error: err.message }, { status: 400 }));
    }
    throw err;
  }
}
