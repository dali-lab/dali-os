import { WebClient } from "@slack/web-api";

export type SlackThreadMessage = {
  ts: string;
  user: string | null;
  text: string;
  files: SlackFile[];
};

export type SlackFile = {
  id: string;
  name: string;
  mimetype: string;
  urlPrivate: string;
};

let cached: WebClient | null = null;
function client(): WebClient {
  if (cached) return cached;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  cached = new WebClient(token);
  return cached;
}

// Test seam: allow tests to swap the client without touching env.
export function __setSlackClientForTests(c: WebClient | null) {
  cached = c;
}

export async function fetchThread(channel: string, threadTs: string): Promise<SlackThreadMessage[]> {
  const res = await client().conversations.replies({
    channel,
    ts: threadTs,
    limit: 200,
  });
  const messages = res.messages ?? [];
  return messages.map((m): SlackThreadMessage => ({
    ts: m.ts ?? "",
    user: (m as { user?: string }).user ?? null,
    text: m.text ?? "",
    files: ((m as { files?: SlackFile[] }).files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      urlPrivate: f.urlPrivate,
    })),
  }));
}

export async function postReply(
  channel: string,
  threadTs: string,
  text: string,
): Promise<{ ts: string }> {
  const res = await client().chat.postMessage({ channel, thread_ts: threadTs, text });
  if (!res.ts) throw new Error("chat.postMessage returned no ts");
  return { ts: res.ts };
}

export async function editMessage(channel: string, ts: string, text: string): Promise<void> {
  await client().chat.update({ channel, ts, text });
}

export async function getPermalink(channel: string, ts: string): Promise<string | null> {
  const res = await client().chat.getPermalink({ channel, message_ts: ts });
  return res.permalink ?? null;
}

// Slack's file URLs (url_private) require the bot token in the Authorization
// header to access. Returns the raw bytes — we re-upload to GitHub elsewhere.
export async function downloadFile(urlPrivate: string): Promise<Buffer> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  const res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Slack file download failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
