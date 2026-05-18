import type { Route } from "./+types/api.f.$token";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { checkRateLimit } from "~/lib/rate-limit";
import { submitPublicForm } from "~/forms/lib/public-form";

// PUBLIC, UNAUTHENTICATED. Submit answers to a published form by its public
// token. No session required — anyone with the link can post. Guarded by an
// IP rate limit + body-size cap (parseJson) since it's an open write path.

const SubmitSchema = z.object({
  versionId: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  submitterName: z.string().trim().max(200).optional(),
  submitterEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // Open endpoint — rate-limit by IP. 10 submissions / 5 min is generous for
  // a human filling a form, tight enough to blunt scripted abuse.
  const limited = checkRateLimit(request, { max: 10, windowMs: 5 * 60_000 });
  if (limited) return withCors(request, limited);

  const body = await parseJson(request, SubmitSchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await submitPublicForm({
    token: params.token!,
    versionId: body.versionId,
    answers: body.answers,
    submitterName: body.submitterName ?? null,
    submitterEmail: body.submitterEmail || null,
  });
  if ("error" in result)
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));

  return withCors(request, Response.json({ ok: true }, { status: 201 }));
}
