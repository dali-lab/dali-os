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

// Top-level (non-thread) channel message. Used by the staffing finalize
// automation to announce a project's confirmed roster.
export async function postMessage(
  channel: string,
  text: string,
): Promise<{ ts: string }> {
  const res = await client().chat.postMessage({ channel, text });
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

// Invite an email to the Slack workspace. admin.users.invite requires an
// ADMIN token (admin.users:write scope) on an Enterprise Grid / Business+
// workspace — distinct from SLACK_BOT_TOKEN. Provide it as SLACK_ADMIN_TOKEN.
// Gated: returns "skipped" when no admin token / team id is configured rather
// than throwing, so onboarding works without it.
export async function inviteToWorkspace(
  email: string,
  channelIds: string[],
): Promise<{ status: "ok" | "skipped" | "error"; message: string }> {
  const token = process.env.SLACK_ADMIN_TOKEN;
  const teamId = process.env.SLACK_TEAM_ID;
  if (!token || !teamId) {
    return { status: "skipped", message: "SLACK_ADMIN_TOKEN / SLACK_TEAM_ID not set." };
  }
  // admin.users.invite requires a channel id. Default to the workspace's
  // #general channel (resolved by name) when the caller passes none — new
  // members always land in general on acceptance.
  let ids = channelIds;
  if (ids.length === 0) {
    const general = await findChannelByName("general");
    if (!general) {
      return { status: "skipped", message: "Could not resolve #general channel for invite." };
    }
    ids = [general.id];
  }
  try {
    const admin = new WebClient(token);
    await admin.admin.users.invite({
      team_id: teamId,
      email,
      channel_ids: ids as [string, ...string[]],
    });
    return { status: "ok", message: `Invited ${email} to Slack.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // already_in_team / already_invited are benign.
    if (/already_(in_team|invited)/.test(msg)) {
      return { status: "ok", message: `${email} already in Slack.` };
    }
    return { status: "error", message: msg };
  }
}

// Resolve a Slack user id from an email via users.lookupByEmail (needs the bot
// token's users:read.email scope). Returns null when the email isn't a Slack
// user or the scope/token is missing — callers treat that as "no Slack account
// yet" rather than an error. Used by the onboarding Slack-account sync.
export async function lookupSlackUserByEmail(email: string): Promise<string | null> {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  try {
    const res = await client().users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch {
    // users_not_found / missing_scope / etc. — no id resolvable.
    return null;
  }
}

// Get-or-create a public channel and return its id + final name. Slack lowercases
// and sanitizes channel names; we pre-sanitize so the stored name matches. If a
// channel with that name already exists, Slack returns name_taken — we resolve
// the existing channel's id instead of failing. Needs channels:manage (create)
// and channels:read (resolve existing).
export async function ensureChannel(
  name: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const safe = sanitizeChannelName(name);
  try {
    const res = await client().conversations.create({ name: safe });
    const id = res.channel?.id;
    if (!id) throw new Error("conversations.create returned no channel id");
    return { id, name: res.channel?.name ?? safe, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/name_taken/.test(msg)) {
      const existing = await findChannelByName(safe);
      if (existing) return { ...existing, created: false };
    }
    throw err;
  }
}

// Invite Slack user ids to a channel. Slack's conversations.invite takes up to
// ~1000 users per call; we pass them comma-joined. already_in_channel and
// not_in_channel-type errors for some users are benign and don't fail the rest.
export async function inviteUsersToChannel(
  channelId: string,
  userIds: string[],
): Promise<{ invited: number; skipped: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return { invited: 0, skipped: 0 };
  try {
    await client().conversations.invite({ channel: channelId, users: unique.join(",") });
    return { invited: unique.length, skipped: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If everyone's already in, that's success; otherwise surface the count.
    if (/already_in_channel/.test(msg)) return { invited: 0, skipped: unique.length };
    throw err;
  }
}

function sanitizeChannelName(name: string): string {
  // Slack channel names: lowercase, no spaces/periods, ≤80 chars, hyphens ok.
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function findChannelByName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  // Page through public channels to find an exact name match. Small workspaces
  // resolve in one page; we cap at a few pages to bound the call.
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await client().conversations.list({
      exclude_archived: true,
      types: "public_channel",
      limit: 1000,
      cursor,
    });
    const match = (res.channels ?? []).find((c) => c.name === name);
    if (match?.id) return { id: match.id, name: match.name ?? name };
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return null;
}
