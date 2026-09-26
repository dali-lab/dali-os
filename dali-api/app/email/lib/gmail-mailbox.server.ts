// Gmail mailbox reads and writes for the Email tab, over the REST API with a
// per-account OAuth token (MailAccount.oauthTokens). Mail stays in Gmail; the
// unified feed fetches it live.

import { prisma } from "~/lib/db";
import { buildEncryptedTokens, parseStoredTokens } from "~/lib/google-calendar";
import { GoogleOAuthError, refreshGoogleToken } from "~/lib/google-oauth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const REFRESH_BUFFER_MS = 60_000;

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export class MailboxError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

export async function getMailboxToken(account: {
  id: string;
  oauthTokens: string | null;
  /** Set when the tokens are the viewer's own sign-in to a Shared inbox. */
  connectionId?: string | null;
}): Promise<string> {
  // Refreshed tokens and errors go back where the tokens came from.
  const save = (data: { oauthTokens?: string; syncError: string | null }) =>
    account.connectionId
      ? prisma.mailAccountConnection.update({ where: { id: account.connectionId }, data })
      : prisma.mailAccount.update({ where: { id: account.id }, data });
  if (!account.oauthTokens) throw new MailboxError("Account is not connected");
  const t = parseStoredTokens(account.oauthTokens);
  if (t.expiresAt && new Date(t.expiresAt).getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return t.accessToken;
  }
  let data;
  try {
    data = await refreshGoogleToken({
      refreshToken: t.refreshToken,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      await save({ syncError: "Sign-in expired. Reconnect this account." });
      throw new MailboxError("Token refresh failed", err.upstreamStatus);
    }
    throw err;
  }
  await save({
    oauthTokens: buildEncryptedTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? t.refreshToken,
      expiresInSec: data.expires_in,
    }),
    syncError: null,
  });
  return data.access_token;
}

async function gmail<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) throw new MailboxError(`Gmail request failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export interface ThreadSummary {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  unread: boolean;
  messageCount: number;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  subject: string;
  messageId: string;
  references: string;
  html: string | null;
  text: string | null;
  attachments: string[];
}

function header(part: GmailPart | undefined, name: string): string {
  const lower = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectParts(part: GmailPart, out: { html?: string; text?: string; attachments: string[] }) {
  if (part.filename) {
    out.attachments.push(part.filename);
    return;
  }
  if (part.body?.data) {
    if (part.mimeType === "text/html" && out.html === undefined) out.html = decodeBody(part.body.data);
    if (part.mimeType === "text/plain" && out.text === undefined) out.text = decodeBody(part.body.data);
  }
  for (const child of part.parts ?? []) collectParts(child, out);
}

const SUMMARY_HEADERS = ["From", "Subject"]
  .map((h) => `metadataHeaders=${h}`)
  .join("&");

export async function listThreads(
  token: string,
  opts: { query: string; max: number },
): Promise<ThreadSummary[]> {
  const params = new URLSearchParams({ q: opts.query, maxResults: String(opts.max) });
  const list = await gmail<{ threads?: { id: string }[] }>(token, `/threads?${params}`);
  const threads = await Promise.all(
    (list.threads ?? []).map((t) =>
      gmail<{ id: string; messages?: GmailMessage[] }>(
        token,
        `/threads/${t.id}?format=metadata&${SUMMARY_HEADERS}`,
      ),
    ),
  );
  return threads.flatMap((t) => {
    const messages = t.messages ?? [];
    const first = messages[0];
    const last = messages[messages.length - 1];
    if (!first || !last) return [];
    return [
      {
        id: t.id,
        subject: header(first.payload, "Subject") || "(no subject)",
        from: header(last.payload, "From"),
        snippet: last.snippet ?? "",
        date: new Date(Number(last.internalDate ?? 0)).toISOString(),
        unread: messages.some((m) => m.labelIds?.includes("UNREAD")),
        messageCount: messages.length,
      },
    ];
  });
}

// Unread messages in the inbox, straight from Gmail's INBOX label counter.
export async function inboxUnreadCount(token: string): Promise<number> {
  const label = await gmail<{ messagesUnread?: number }>(token, "/labels/INBOX");
  return label.messagesUnread ?? 0;
}

export async function getThread(token: string, threadId: string): Promise<MailMessage[]> {
  const t = await gmail<{ messages?: GmailMessage[] }>(
    token,
    `/threads/${encodeURIComponent(threadId)}?format=full`,
  );
  return (t.messages ?? []).map((m) => {
    const body: { html?: string; text?: string; attachments: string[] } = { attachments: [] };
    if (m.payload) collectParts(m.payload, body);
    return {
      id: m.id,
      from: header(m.payload, "From"),
      to: header(m.payload, "To"),
      cc: header(m.payload, "Cc"),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(),
      subject: header(m.payload, "Subject"),
      messageId: header(m.payload, "Message-ID"),
      references: header(m.payload, "References"),
      html: body.html ?? null,
      text: body.text ?? null,
      attachments: body.attachments,
    };
  });
}

export async function modifyThread(
  token: string,
  threadId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  await gmail(token, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] }),
  });
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

// RFC 2047 encoded-word so non-ASCII subjects survive transport.
function encodeSubject(subject: string): string {
  const clean = sanitizeHeader(subject);
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export async function sendMessage(
  token: string,
  msg: {
    from: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    threadId?: string | null;
    inReplyTo?: string;
    references?: string;
  },
): Promise<void> {
  const headers = [
    `From: ${sanitizeHeader(msg.from)}`,
    `To: ${sanitizeHeader(msg.to)}`,
    ...(msg.cc.trim() ? [`Cc: ${sanitizeHeader(msg.cc)}`] : []),
    // Gmail delivers to Bcc and strips the header from what recipients get.
    ...(msg.bcc.trim() ? [`Bcc: ${sanitizeHeader(msg.bcc)}`] : []),
    `Subject: ${encodeSubject(msg.subject)}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${sanitizeHeader(msg.inReplyTo)}`] : []),
    ...(msg.inReplyTo
      ? [`References: ${sanitizeHeader(`${msg.references ?? ""} ${msg.inReplyTo}`.trim())}`]
      : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const raw = `${headers.join("\r\n")}\r\n\r\n${Buffer.from(msg.body, "utf8").toString("base64")}`;
  await gmail(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({
      raw: Buffer.from(raw, "utf8").toString("base64url"),
      ...(msg.threadId ? { threadId: msg.threadId } : {}),
    }),
  });
}
