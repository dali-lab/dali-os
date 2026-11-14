import { z } from "zod";
import { requireShowcaseSecret } from "./public-auth.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { sendWebsiteMeetingRequestEmail } from "~/partners/lib/partner-emails.server";

// The one write on the public surface: dali.website's support plan finder asks
// DALI OS to email partners@ when a partner wants to meet. It only ever mails
// that fixed inbox, so the secret can't be used to send mail anywhere else.

const text = (max: number) => z.string().trim().min(1).max(max);

export const MeetingRequestBody = z.object({
  name: text(200),
  email: z.string().trim().email().max(320),
  org: text(200),
  project: text(200),
  need: text(200),
  plan: text(200),
  payer: text(200),
  notes: z.string().trim().max(4000).optional(),
});

export async function handleWebsiteMeetingRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  if (!(await isFeatureEnabledForEveryone("website-meeting-requests", request))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = MeetingRequestBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  await sendWebsiteMeetingRequestEmail({ ...parsed.data, notes: parsed.data.notes || null });
  return Response.json({ ok: true });
}
