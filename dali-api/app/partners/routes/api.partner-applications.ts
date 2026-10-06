import type { Route } from "./+types/api.partner-applications";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { createPartnerApplication } from "../lib/partner-application-create.server";

// POST /api/partner-applications
//
// JSON create path for the board's create-mode modal (specs/partner-crm.md
// §5): unlike the route's form-based create intent (core.partners.tsx,
// still used by the list view's inline form), this returns `{ id }` instead
// of redirecting, so the modal can close and let the board revalidate in
// place rather than navigating to the new application's full page. Same
// validation and side effects via the shared createPartnerApplication()
// helper. Same permission model as the board's other write endpoints
// (isCore).

type Body = {
  title: string;
  applicantName?: string | null;
  applicantEmail: string;
  summary?: string | null;
  source?: string | null;
  targetTermIds?: string[];
  domainIds?: string[];
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (typeof o.applicantEmail !== "string") return false;
  if (o.applicantName != null && typeof o.applicantName !== "string") return false;
  if (o.summary != null && typeof o.summary !== "string") return false;
  if (o.source != null && typeof o.source !== "string") return false;
  if (
    o.targetTermIds !== undefined &&
    !(Array.isArray(o.targetTermIds) && o.targetTermIds.every((v) => typeof v === "string"))
  ) {
    return false;
  }
  if (
    o.domainIds !== undefined &&
    !(Array.isArray(o.domainIds) && o.domainIds.every((v) => typeof v === "string"))
  ) {
    return false;
  }
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
  if (!(await isCore(auth.user.sub))) {
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

  const result = await createPartnerApplication({
    title: body.title,
    applicantName: body.applicantName,
    applicantEmail: body.applicantEmail,
    summary: body.summary,
    source: body.source,
    targetTermIds: body.targetTermIds,
    domainIds: body.domainIds,
    actorUserId: auth.user.sub,
  });
  if ("error" in result) {
    return withCors(request, Response.json({ error: result.error }, { status: 400 }));
  }

  return withCors(request, Response.json({ id: result.id }));
}
