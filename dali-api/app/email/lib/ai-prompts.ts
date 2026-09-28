// Prompts for the Email tab's AI tools. Pure so they can be unit-tested; the
// model call, rate limits and quota live in /api/ai/email.

export const WRITING_TASKS = ["draft", "rephrase", "proofread", "translate"] as const;
export type WritingTask = (typeof WRITING_TASKS)[number];

export const MAX_CONTEXT_CHARS = 12_000;

const PLAIN = "Return only the email body as plain text: no subject line, no preamble, no markdown.";

export function writingSystemPrompt(task: WritingTask, language?: string): string {
  switch (task) {
    case "draft":
      return `You write emails for a member of DALI, a student design and development lab at Dartmouth. Write a clear, friendly, concise email that does what the user asks. If an earlier thread is given, write a reply to its latest message. Sign off without inventing a name unless one is given. ${PLAIN}`;
    case "rephrase":
      return `Rewrite the user's email draft following their instruction if one is given, otherwise make it clearer and more concise. Keep the meaning, facts, names and language. ${PLAIN}`;
    case "proofread":
      return `Proofread the user's email draft: fix spelling, grammar and punctuation, and awkward phrasing. Do not change the meaning, tone or language, and keep changes minimal. ${PLAIN}`;
    case "translate":
      return `Translate the user's email draft into ${language || "English"}. Keep the tone, names and formatting. ${PLAIN}`;
  }
}

export function writingUserPrompt(opts: {
  task: WritingTask;
  text: string;
  instruction?: string;
  thread?: string;
}): string {
  const parts: string[] = [];
  if (opts.thread) parts.push(`Earlier thread (oldest first):\n${opts.thread}`);
  if (opts.task === "draft") {
    parts.push(`What to write: ${opts.instruction || "A reply to the latest message."}`);
    if (opts.text.trim()) parts.push(`Notes or partial draft to build on:\n${opts.text}`);
  } else {
    if (opts.instruction) parts.push(`Instruction: ${opts.instruction}`);
    parts.push(`Draft:\n${opts.text}`);
  }
  return parts.join("\n\n");
}

export function searchSystemPrompt(today: string, accounts: { id: string; label: string }[]): string {
  const list = accounts.map((a) => `- ${a.id}: ${a.label}`).join("\n");
  return `You turn a plain-English email search into a Gmail search query. Today is ${today}.
Use Gmail operators where they fit: from:, to:, subject:, has:attachment, is:unread, is:starred, in:inbox, in:sent, newer_than:, older_than:, after:YYYY/MM/DD, before:YYYY/MM/DD, and bare keywords. Resolve relative dates against today.
The user has these inboxes (id: name):
${list}
If the search names specific inboxes, list their ids; otherwise return an empty list.
Reply with JSON only, exactly: {"query": "<gmail query>", "accounts": ["<id>", ...]}`;
}

export function parseSearchResponse(
  raw: string,
  accountIds: string[],
): { query: string; accounts: string[] } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { query?: unknown; accounts?: unknown };
    if (typeof parsed.query !== "string") return null;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.filter((a): a is string => typeof a === "string" && accountIds.includes(a))
      : [];
    return { query: parsed.query.trim(), accounts };
  } catch {
    return null;
  }
}

export function threadToContext(
  messages: { from: string; date: string; text: string | null; html: string | null }[],
): string {
  const joined = messages
    .map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.text ?? htmlToText(m.html ?? "")}`)
    .join("\n\n---\n\n");
  return joined.length > MAX_CONTEXT_CHARS ? joined.slice(-MAX_CONTEXT_CHARS) : joined;
}

// Removes every match, re-running until nothing changes, so a nested or
// split-up tag (`<scr<script>ipt>`) can't reassemble after one pass.
function removeAll(text: string, pattern: RegExp): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, "");
  } while (text !== previous);
  return text;
}

// Rough HTML → text for model context only; never rendered. Still stripped
// thoroughly: no tag, and no stray angle bracket, survives.
export function htmlToText(html: string): string {
  const withBreaks = removeAll(html, /<(style|script)\b[\s\S]*?<\/\1\s*>/gi)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n");
  return removeAll(withBreaks, /<[^<>]*>/g)
    .replace(/[<>]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
