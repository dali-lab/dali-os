import type { Route } from "./+types/api.forms.fill.$token";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { submitMemberForm } from "~/forms/lib/public-form";

// AUTHENTICATED member submit for slot-bound forms. The session identifies
// the submitter (no name/email body), which is what makes form-driven
// Project Bids safe — submitMemberForm resolves the slot binding server-side
// and interprets answers into StaffingPreference for THIS member.

const SubmitSchema = z.object({
  versionId: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await requireMember(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Lab members only" }, { status: 403 }));
  }

  const body = await parseJson(request, SubmitSchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await submitMemberForm({
    token: params.token!,
    versionId: body.versionId,
    userId: auth.user.sub,
    answers: body.answers,
  });
  if ("error" in result)
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));

  return withCors(request, Response.json({ ok: true }, { status: 201 }));
}
