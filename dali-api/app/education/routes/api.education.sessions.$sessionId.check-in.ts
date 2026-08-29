import type { Route } from "./+types/api.education.sessions.$sessionId.check-in";
import { requireAuth } from "~/lib/auth";
import { selfCheckInToSession } from "~/education/lib/session-checkin.server";

// POST /api/education/sessions/:sessionId/check-in
//
// Self-serve attendance for an education session — the student scans the
// projected QR (or opens the link), and this marks THEM present. Like the
// meeting self-check-in route, there is no token in the body: the user is taken
// from their own session (auth.user.sub), so it can never mark someone else. The
// session must have check-in open and be inside its window, and the caller must
// be an Approved enrollee — all enforced in selfCheckInToSession.

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.type === "applicant") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await selfCheckInToSession({
    sessionId: params.sessionId!,
    userId: auth.user.sub,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, alreadyPresent: result.alreadyPresent });
}
