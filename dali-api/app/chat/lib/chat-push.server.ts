import { prisma } from "~/lib/db";
import { getAppEnv } from "~/lib/app-env";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const PUSH_BATCH_SIZE = 100;
export const PUSH_BODY_MAX = 180;

export interface PushConversation {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  memberIds: string[];
}

export interface PushMessage {
  id: string;
  authorId: string;
  text: string;
  parentId: string | null;
  kind: "user" | "system";
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { conversationId: string; messageId: string; parentId: string | null };
  sound: "default";
  threadId: string;
}

type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

// Staging restores prod snapshots, so real members' devices are registered
// there too; same reasoning as slackDmAllowed().
export function pushAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_PUSH_OVERRIDE === "1";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionsHandle(text: string, handle: string): boolean {
  if (!handle) return false;
  return new RegExp(`(^|[^\\w@])@${escapeRegExp(handle)}(?![\\w-])`, "i").test(text);
}

export function pushRecipientIds(input: {
  conversationKind: "channel" | "dm";
  messageKind: "user" | "system";
  memberIds: string[];
  authorId: string;
  text: string;
  handles: Record<string, string | null>;
  threadParticipantIds: string[];
}): string[] {
  if (input.messageKind === "system") return [];
  const others = [...new Set(input.memberIds)].filter((id) => id !== input.authorId);
  if (input.conversationKind === "dm") return others;
  const thread = new Set(input.threadParticipantIds);
  return others.filter((id) => {
    const handle = input.handles[id];
    return thread.has(id) || (handle ? mentionsHandle(input.text, handle) : false);
  });
}

export function truncate(text: string, max = PUSH_BODY_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function pushTitle(input: {
  conversationKind: "channel" | "dm";
  channelName: string | null;
  senderName: string;
  otherMemberFirstNames: string[];
}): string {
  if (input.conversationKind === "channel") return `#${input.channelName ?? "channel"}`;
  if (input.otherMemberFirstNames.length <= 1) return input.senderName;
  return `${input.senderName} in ${input.otherMemberFirstNames.join(", ")}`;
}

export function pushBody(conversationKind: "channel" | "dm", senderName: string, text: string): string {
  return conversationKind === "channel" ? truncate(`${senderName}: ${text}`) : truncate(text);
}

export function chunk<T>(items: T[], size = PUSH_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function deadTokens(batch: ExpoPushMessage[], tickets: ExpoTicket[]): string[] {
  return tickets.flatMap((ticket, i) =>
    ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered" && batch[i] ? [batch[i].to] : [],
  );
}

export async function deliverPushes(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: number; removed: number }> {
  const dead: string[] = [];
  let sent = 0;
  for (const batch of chunk(messages)) {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error(`[chat-push] Expo push request failed with ${res.status}`);
      continue;
    }
    const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
    const tickets = json?.data ?? [];
    sent += tickets.filter((t) => t.status === "ok").length;
    dead.push(...deadTokens(batch, tickets));
  }
  if (dead.length > 0) await prisma.mobilePushToken.deleteMany({ where: { token: { in: dead } } });
  return { sent, removed: dead.length };
}

const displayName = (u: { firstName: string; lastName: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || "Someone";

export async function sendChatPush(
  conversation: PushConversation,
  message: PushMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (message.kind === "system" || !pushAllowed()) return;

  const [users, threadRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: conversation.memberIds } },
      select: { id: true, firstName: true, lastName: true, handle: true },
    }),
    message.parentId
      ? prisma.chatMessage.findMany({
          where: { OR: [{ id: message.parentId }, { parentId: message.parentId }] },
          select: { authorId: true },
        })
      : Promise.resolve([]),
  ]);

  const recipients = pushRecipientIds({
    conversationKind: conversation.kind,
    messageKind: message.kind,
    memberIds: conversation.memberIds,
    authorId: message.authorId,
    text: message.text,
    handles: Object.fromEntries(users.map((u) => [u.id, u.handle])),
    threadParticipantIds: threadRows.map((r) => r.authorId),
  });
  if (recipients.length === 0) return;

  const tokens = await prisma.mobilePushToken.findMany({
    where: { userId: { in: recipients } },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const author = users.find((u) => u.id === message.authorId);
  const senderName = author ? displayName(author) : "Someone";
  const title = pushTitle({
    conversationKind: conversation.kind,
    channelName: conversation.name,
    senderName,
    otherMemberFirstNames: users
      .filter((u) => u.id !== message.authorId)
      .map((u) => u.firstName || displayName(u)),
  });
  const body = pushBody(conversation.kind, senderName, message.text);

  await deliverPushes(
    tokens.map(({ token }) => ({
      to: token,
      title,
      body,
      data: { conversationId: conversation.id, messageId: message.id, parentId: message.parentId },
      sound: "default",
      threadId: conversation.id,
    })),
    fetchImpl,
  );
}
