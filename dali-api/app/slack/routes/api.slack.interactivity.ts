import type { Route } from "./+types/api.slack.interactivity";
import { verifySlackSignature } from "../lib/verify-signature";

// Stub for Slack interactivity (buttons, modals). Wired in routes.ts and
// configured in the Slack app so we don't have to re-do the app config when
// we add real handlers in v2. For now it verifies the signature and 200s.
export async function action({ request }: Route.ActionArgs) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return Response.json({ error: "Slack bot disabled" }, { status: 503 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const rawBody = await request.text();
  const verification = verifySlackSignature({
    signingSecret,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!verification.ok) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  return Response.json({ ok: true });
}
