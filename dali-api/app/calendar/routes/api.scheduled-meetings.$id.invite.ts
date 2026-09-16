import type { Route } from "./+types/api.scheduled-meetings.$id.invite";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { inviteToScheduledMeeting } from "~/lib/scheduled-meeting";

const InviteSchema = z
  .object({
    userIds: z.array(z.string().min(1)).max(500).default([]),
    groupIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .refine((v) => v.userIds.length + v.groupIds.length > 0, {
    message: "Pick at least one person or group",
  });

// Add guests to an existing meeting (see inviteToScheduledMeeting). Additive —
// removing guests or changing scope stays on the edit route.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, InviteSchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await inviteToScheduledMeeting(params.id!, auth.user.sub, body);
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json(result));
}
