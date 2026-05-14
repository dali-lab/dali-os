import type { SlackThreadMessage } from "./slack-client";

const TITLE_MAX = 80;
const TITLE_PREFIX = "[Slack] ";

export type UploadedAsset = {
  // Original filename, used for the alt text.
  filename: string;
  // Public URL (e.g. raw.githubusercontent.com) that GitHub can render.
  url: string;
};

export type FormatIssueInput = {
  thread: SlackThreadMessage[];
  // Slack permalink for the parent message. Linked in the issue header.
  permalink: string | null;
  // The user who @-mentioned the bot.
  requestedBySlackUserId: string;
  // Images already uploaded somewhere GitHub can render them, keyed by Slack file id.
  assetsByFileId: Record<string, UploadedAsset>;
};

export type FormatIssueResult = { title: string; body: string };

// Strip the @<botUserId> mention noise out of message text before rendering.
// Slack mentions look like "<@U12345> hello" — we drop the entire token.
function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s?/g, "").trim();
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  return nl === -1 ? trimmed : trimmed.slice(0, nl);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function tsToIso(ts: string): string {
  // Slack ts is "<seconds>.<microseconds>".
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return ts;
  return new Date(seconds * 1000).toISOString();
}

export function formatIssue(input: FormatIssueInput): FormatIssueResult {
  const { thread, permalink, requestedBySlackUserId, assetsByFileId } = input;
  const parent = thread[0];
  if (!parent) {
    return { title: `${TITLE_PREFIX}(empty thread)`, body: "(empty Slack thread)" };
  }

  const titleSource = stripMentions(parent.text) || "(no text)";
  const title = TITLE_PREFIX + truncate(firstLine(titleSource), TITLE_MAX - TITLE_PREFIX.length);

  const lines: string[] = [];
  lines.push(`_Filed from Slack by <@${requestedBySlackUserId}>._`);
  if (permalink) lines.push(`Original thread: ${permalink}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of thread) {
    const author = msg.user ? `**<@${msg.user}>**` : "**(unknown)**";
    const when = tsToIso(msg.ts);
    lines.push(`${author} · \`${when}\``);
    lines.push("");

    const body = stripMentions(msg.text);
    if (body) {
      // Indent every line as a blockquote so consecutive messages render distinctly.
      for (const ln of body.split("\n")) lines.push(`> ${ln}`);
      lines.push("");
    }

    for (const f of msg.files) {
      const asset = assetsByFileId[f.id];
      if (asset && f.mimetype.startsWith("image/")) {
        lines.push(`![${asset.filename}](${asset.url})`);
      } else if (asset) {
        lines.push(`[${asset.filename}](${asset.url})`);
      } else {
        // Asset upload failed or wasn't attempted — surface that explicitly
        // so the issue body reflects reality, but don't abort the whole flow.
        lines.push(`_Attachment: ${f.name} (upload failed — see Slack thread)_`);
      }
      lines.push("");
    }
  }

  return { title, body: lines.join("\n").trimEnd() + "\n" };
}
