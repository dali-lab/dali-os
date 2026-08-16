import type { Route } from "./+types/api.forms.fill.$token";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireAuth, unauthorized } from "~/lib/auth";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import {
  formAccessMeta,
  formFillAccess,
  submitAnonymousForm,
  submitMemberForm,
} from "~/forms/lib/public-form";

// Submit endpoint for /forms/fill/:token. Who may submit is the form's
// audience setting, enforced through the same formFillAccess gate the fill
// page loader uses. Signed-in submitters are identified by their session (no
// name/email body) — that's what makes form-driven Project Bids safe:
// submitMemberForm resolves the slot binding server-side and interprets
// answers into StaffingPreference for THIS member. Public-audience forms
// accept anonymous submissions (rate-limited per IP, IP recorded).

const SubmitSchema = z.object({
  versionId: z.string().min(1),
  // Fingerprint the client captured at load (FormVersion.updatedAt). Optional
  // for back-compat; when present, a stale version is rejected server-side.
  versionUpdatedAt: z.string().optional(),
  answers: z.record(z.string(), z.unknown()),
  // Education feedback context from the fill URL. Optional; validated
  // server-side inside submitMemberForm against EducationFormBinding.
  educationSessionId: z.string().nullish(),
  educationOfferingId: z.string().nullish(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const meta = await formAccessMeta(params.token!);
  if (!meta) {
    return withCors(request, Response.json({ error: "Form not found for this link." }, { status: 404 }));
  }

  // Optional session: a failure here only matters for non-public forms.
  const auth = await requireAuth(request);
  const userId = auth.ok ? auth.user.sub : null;

  const body = await parseJson(request, SubmitSchema);
  if (body instanceof Response) return withCors(request, body);

  const hasEducationContext = Boolean(
    body.educationSessionId || body.educationOfferingId,
  );

  // Education-context fills bypass the audience gate — educationFillContext
  // (inside submitMemberForm) is their authorization. A session is still
  // required so the submission is attributable to the enrollee/instructor.
  if (!hasEducationContext) {
    const access = await formFillAccess(meta, userId);
    if (access === "login") {
      return withCors(request, auth.ok ? unauthorized(request) : auth.response);
    }
    if (access === "denied") {
      return withCors(
        request,
        Response.json({ error: "You don't have access to this form." }, { status: 403 }),
      );
    }
  } else if (!auth.ok) {
    return withCors(request, auth.response);
  }

  if (!userId) {
    // Anonymous Public fill: unauthenticated endpoints need their own abuse
    // guard — per-IP rate limit, and the IP is recorded on the submission.
    const ip = getClientIp(request);
    const limited = checkRateLimit(
      request,
      { max: 10, windowMs: 10 * 60_000 },
      `form-fill:${ip}`,
    );
    if (limited) return withCors(request, limited);

    const result = await submitAnonymousForm({
      token: params.token!,
      versionId: body.versionId,
      versionUpdatedAt: body.versionUpdatedAt,
      answers: body.answers,
      submitterIp: ip === "unknown" ? null : ip,
    });
    if ("error" in result)
      return withCors(request, Response.json({ error: result.error }, { status: result.status }));
    return withCors(request, Response.json({ ok: true }, { status: 201 }));
  }

  const result = await submitMemberForm({
    token: params.token!,
    versionId: body.versionId,
    versionUpdatedAt: body.versionUpdatedAt,
    userId,
    answers: body.answers,
    education: hasEducationContext
      ? {
          sessionId: body.educationSessionId ?? null,
          offeringId: body.educationOfferingId ?? null,
        }
      : undefined,
  });
  if ("error" in result)
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));

  return withCors(request, Response.json({ ok: true }, { status: 201 }));
}
