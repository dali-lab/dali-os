import type { Route } from "./+types/api.agreements.issue";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { previewTermIssue, issueTermAgreements } from "~/signing/lib/issue.server";

// GET  /api/agreements/issue        → preview this term's issuable agreements +
//                                      the roster each would notify (for the
//                                      "send what to whom" confirm).
// POST /api/agreements/issue        → { documentIds: string[] } put each in force
//                                      for the current term and send sign
//                                      requests. Core-only (only Core issues
//                                      agreements). Backs the staffing board's
//                                      "Issue term agreements" action.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(await previewTermIssue());
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { documentIds?: unknown };
  const documentIds = Array.isArray(body.documentIds)
    ? body.documentIds.filter((v): v is string => typeof v === "string")
    : [];
  if (documentIds.length === 0) {
    return Response.json({ error: "No agreements selected." }, { status: 400 });
  }

  const result = await issueTermAgreements({
    documentIds,
    userId: auth.user.sub,
    request,
  });
  return Response.json(result);
}
