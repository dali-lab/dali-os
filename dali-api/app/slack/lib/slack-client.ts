import { WebClient } from "@slack/web-api";
import { sanitizeChannelName } from "./channel-name";
export { sanitizeChannelName };

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
      if (existing) {
        // An archived channel keeps its name reserved (so create still reports
        // name_taken) but can't be posted to or invited to until reopened.
        // Unarchive it so the rest of the finalize flow works; needs
        // channels:manage, which the same get-or-create path already requires.
        if (existing.archived) {
          await client().conversations.unarchive({ channel: existing.id });
        }
        return { id: existing.id, name: existing.name, created: false };
      }
      // Name is taken but we couldn't resolve the channel — almost always a
      // missing channels:read scope (listing returned nothing) rather than a
      // truly missing channel. Say so instead of bubbling a bare name_taken.
      throw new Error(
        `${msg} — a channel named "${safe}" already exists but couldn't be resolved. ` +
          `The Slack bot likely needs the channels:read (and groups:read for private channels) scope to look it up.`,
      );
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

// Build an actionable message for a Slack missing_scope failure. Slack's
// PlatformError carries the raw API response on `err.data`, which for
// missing_scope includes `needed` (the exact scope this call required) and
// `provided` (what the token actually has). Surfacing `needed` points the lead
// at the ONE scope to add, instead of a static guess-list of every scope the
// feature ever uses — the common confusion when most of the list is already
// granted (e.g. the channel-resolve path needs channels:read specifically).
export function slackMissingScopeMsg(err: unknown, raw: string): string {
  const data =
    typeof err === "object" && err !== null && "data" in err
      ? (err as { data?: { needed?: string; provided?: string } }).data
      : undefined;
  const needed = data?.needed?.trim();
  if (needed) {
    return `${raw} — the Slack bot token is missing the "${needed}" scope. Add it in the Slack app config (Bot Token Scopes) and reinstall the app to the workspace.`;
  }
  return `${raw} — the Slack bot token is missing a required scope. Check the call's needed scope in the Slack app config (Bot Token Scopes) and reinstall.`;
}


// Shared Slack/integration error formatter: maps common Slack API error codes
// (and the GitHub teams "Not Found" variant) to actionable hints so leads can
// self-diagnose without reading API docs. Falls back to the raw message.
export function slackErrorMessage(err: unknown, raw?: string): string {
  const message = raw ?? (err instanceof Error ? err.message : String(err));
  if (/missing_scope/i.test(message)) {
    return slackMissingScopeMsg(err, message);
  }
  if (/not_in_channel|channel_not_found/i.test(message)) {
    return `${message} — the Slack bot isn't a member of that channel. Invite the bot to it, or let finalize create the channel.`;
  }
  if (/\bNot Found\b/.test(message) && /teams\/members/.test(message)) {
    return `${message} — couldn't add a GitHub team member. Check that the GitHub App is installed on GITHUB_ORG with the "Members: read & write" org permission, and that each member's githubUsername is a real GitHub login.`;
  }
  return message;
}

async function findChannelByName(
  name: string,
): Promise<{ id: string; name: string; archived: boolean } | null> {
  // Page through channels to find an exact name match. conversations.create
  // reports name_taken for ARCHIVED and PRIVATE channels too, so the resolve
  // fallback must look at those — otherwise a re-used name (the common case for
  // a channel "shared with the project page") fails with a raw name_taken even
  // though we could have found it. Include archived + private channels in the
  // listing; exclude_archived defaults to false so archived ones are returned.
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await client().conversations.list({
      types: "public_channel,private_channel",
      limit: 1000,
      cursor,
    });
    const match = (res.channels ?? []).find((c) => c.name === name);
    if (match?.id) {
      return { id: match.id, name: match.name ?? name, archived: !!match.is_archived };
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return null;
}
