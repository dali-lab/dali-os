import type { Route } from "./+types/api.slack.events";
import { verifySlackSignature } from "../lib/verify-signature";
import { handleAppMention, type AppMentionEvent } from "../lib/handle-mention";
import { handleReactionAdded, type ReactionAddedEvent } from "../lib/handle-reaction";

// Slack Events API webhook. Two responsibilities:
// 1. Respond to Slack's URL verification challenge during app setup.
// 2. Verify signatures and dispatch app_mention / reaction_added events.
//
// Slack expects a 2xx within 3 seconds or it retries; the heavy lifting
// (Slack API calls, GitHub API calls) is fired off after we've already
// responded so we never hit the deadline.
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

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1. URL verification (one-time during Slack app setup).
  if (payload.type === "url_verification") {
    return new Response(payload.challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // 2. Event callback. Ack synchronously, dispatch async.
  if (payload.type === "event_callback" && payload.event) {
    dispatchEvent(payload.event);
  }

  return Response.json({ ok: true });
}

type SlackEventEnvelope = {
  type: "url_verification" | "event_callback";
  challenge?: string;
  event?: { type: string } & Record<string, unknown>;
};

function dispatchEvent(event: { type: string } & Record<string, unknown>): void {
  // We intentionally do NOT await — Slack must get a response within 3s.
  // Errors inside handlers are logged but never propagated to Slack so it
  // doesn't retry against an already-processed event.
  switch (event.type) {
    case "app_mention":
      void handleAppMention(event as unknown as AppMentionEvent).catch((err) => {
        console.error("slack: handleAppMention failed", err);
      });
      break;
    case "reaction_added":
      void handleReactionAdded(event as unknown as ReactionAddedEvent).catch((err) => {
        console.error("slack: handleReactionAdded failed", err);
      });
      break;
    default:
      // Unknown subscribed event — silently ignore; we still 200 to Slack.
      break;
  }
}
