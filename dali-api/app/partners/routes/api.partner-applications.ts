import type { Route } from "./+types/api.partner-applications";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { createPartnerApplication } from "../lib/partner-application-create.server";

// POST /api/partner-applications
//
// JSON create path for the Partners page's create-mode modal (board and list
// views share it, specs/partner-crm.md §5). Returns `{ id }` rather than
// redirecting so the modal can close and the page revalidates in place. Same
// permission model as the board's other write endpoints (isCore).

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
