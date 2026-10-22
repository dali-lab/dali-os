// MCP tool area: chat. Aggregated into app/mcp/registry.ts.
// Thin adapters over app/chat/lib/chat.server.ts, so MCP callers get exactly the
// mobile app's access rules, system messages, live events and push.

import type { z } from "zod";
import type { McpCtx, McpTool } from "../../registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError, requireForAction } from "../../errors";
import { prisma } from "~/lib/db";
import { isMobileAppEnabled } from "~/lib/mobile-auth.server";
import { listMemberSummaries } from "~/lib/mobile-members.server";
import {
  bootstrap,
  createChannel,
  inviteMembers,
  joinChannel,
  leaveChannel,
  listMessages,
  markRead,
  openDirectMessage,
  sendMessage,
  toggleReaction,
  type ChatResult,
  type WireConversation,
  type WireMessage,
} from "~/chat/lib/chat.server";
import {
  createChannelSchema,
  membersSchema,
  openDmSchema,
  reactionSchema,
  sendMessageSchema,
  toChannelSlug,
} from "~/chat/lib/chat-rules";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

const TARGET_PROPS = {
  conversationId: { type: "string", description: "Conversation id (from list_chat_conversations)." },
  channel: { type: "string", description: "Channel name, with or without the leading #. Alternative to conversationId." },
} as const;

type Names = Map<string, string>;

export async function requireChat(ctx: McpCtx): Promise<string> {
  if (!(await isMobileAppEnabled(ctx.user.id, ctx.request))) {
    throw new McpNotFoundError("Chat isn't available for this account");
  }
  return ctx.user.id;
}

export function unwrap<T>(result: ChatResult<T>): T {
  if (result.ok) return result.data;
  if (result.status === 404) throw new McpNotFoundError(result.error);
  if (result.status === 403) throw new McpForbiddenError(result.error);
  throw new McpError(result.error, result.status);
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new McpInvalidError(parsed.error.issues[0]?.message ?? "Invalid params");
  return parsed.data;
}

export async function resolveConversationId(args: { conversationId?: unknown; channel?: unknown }): Promise<string> {
  if (typeof args.conversationId === "string" && args.conversationId) return args.conversationId;
  if (typeof args.channel === "string" && args.channel.trim()) {
    const name = toChannelSlug(args.channel.replace(/^#/, ""));
    const row = await prisma.chatConversation.findUnique({ where: { name }, select: { id: true } });
    if (!row) throw new McpNotFoundError(`No channel named #${name}`);
    return row.id;
  }
  throw new McpInvalidError("Pass conversationId or channel");
}

async function namesFor(ids: Iterable<string>): Promise<Names> {
  const unique = [...new Set(ids)];
  const members = unique.length ? await listMemberSummaries(unique) : [];
  return new Map(members.map((m) => [m.id, m.name]));
}

export function conversationTitle(c: WireConversation, meId: string, names: Names): string {
  if (c.kind === "channel") return `#${c.name}`;
  const others = c.memberIds.filter((id) => id !== meId).map((id) => names.get(id) ?? "Unknown");
  return others.length ? others.join(", ") : "You";
}

export function formatMessage(m: WireMessage, names: Names, replyCount?: number) {
  return {
    id: m.id,
    author: names.get(m.authorId) ?? "Unknown",
    authorId: m.authorId,
    text: m.kind === "system" ? `${names.get(m.authorId) ?? "Someone"} ${m.text}` : m.text,
    kind: m.kind,
    createdAt: m.createdAt,
    threadId: m.parentId,
    ...(replyCount !== undefined ? { replyCount } : {}),
    reactions: m.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.userIds.length,
      by: r.userIds.map((id) => names.get(id) ?? "Unknown"),
    })),
  };
}

export function unreadCount(c: WireConversation, messages: WireMessage[], meId: string): number {
  if (!c.memberIds.includes(meId)) return 0;
  const lastRead = new Date(c.lastReadAt).getTime();
  return messages.filter(
    (m) =>
      m.conversationId === c.id &&
      !m.parentId &&
      m.kind === "user" &&
      m.authorId !== meId &&
      new Date(m.createdAt).getTime() > lastRead,
  ).length;
}

export async function runListChatConversations(ctx: McpCtx, args: { includeBrowsable?: boolean; unreadOnly?: boolean }) {
  const meId = await requireChat(ctx);
  const { conversations, messages } = await bootstrap(meId);
  const names = await namesFor([
    ...conversations.flatMap((c) => c.memberIds),
    ...messages.map((m) => m.authorId),
  ]);
  const rows = conversations
    .filter((c) => args.includeBrowsable || c.memberIds.includes(meId))
    .map((c) => {
      const roots = messages.filter((m) => m.conversationId === c.id && !m.parentId);
      const last = roots[roots.length - 1];
      return {
        id: c.id,
        kind: c.kind,
        title: conversationTitle(c, meId, names),
        topic: c.topic,
        isPrivate: c.isPrivate,
        isMember: c.memberIds.includes(meId),
        memberCount: c.memberIds.length,
        unreadCount: unreadCount(c, messages, meId),
        lastMessage: last ? formatMessage(last, names) : null,
        lastActivityAt: last?.createdAt ?? c.createdAt,
      };
    })
    .filter((r) => !args.unreadOnly || r.unreadCount > 0)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { conversations: rows };
}

export async function runReadChatMessages(
  ctx: McpCtx,
  args: { conversationId?: string; channel?: string; threadId?: string; before?: string; limit?: number },
) {
  const meId = await requireChat(ctx);
  const conversationId = await resolveConversationId(args);
  const before = args.before ? new Date(args.before) : undefined;
  if (before && Number.isNaN(before.getTime())) throw new McpInvalidError("before must be an ISO date");
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
  const page = unwrap(await listMessages(meId, conversationId, before));
  const names = await namesFor(page.flatMap((m) => [m.authorId, ...m.reactions.flatMap((r) => r.userIds)]));

  if (args.threadId) {
    const root = page.find((m) => m.id === args.threadId && !m.parentId);
    if (!root) throw new McpNotFoundError("Thread not found");
    const replies = page.filter((m) => m.parentId === root.id);
    return { conversationId, thread: formatMessage(root, names, replies.length), replies: replies.map((m) => formatMessage(m, names)) };
  }

  const roots = page.filter((m) => !m.parentId);
  const shown = roots.slice(-limit);
  const replyCounts = new Map<string, number>();
  for (const m of page) if (m.parentId) replyCounts.set(m.parentId, (replyCounts.get(m.parentId) ?? 0) + 1);
  return {
    conversationId,
    messages: shown.map((m) => formatMessage(m, names, replyCounts.get(m.id) ?? 0)),
    nextBefore: roots.length > shown.length || roots.length >= MAX_LIMIT ? shown[0]?.createdAt ?? null : null,
  };
}

export async function runSendChatMessage(
  ctx: McpCtx,
  args: { conversationId?: string; channel?: string; userIds?: string[]; text?: string; threadId?: string },
) {
  const meId = await requireChat(ctx);
  const targets = [args.conversationId, args.channel, args.userIds?.length ? args.userIds : undefined].filter(Boolean);
  if (targets.length !== 1) throw new McpInvalidError("Pass exactly one of conversationId, channel, or userIds");
  const body = parse(sendMessageSchema, { text: args.text, parentId: args.threadId });
  const conversationId = args.userIds?.length
    ? unwrap(await openDirectMessage(meId, parse(openDmSchema, { userIds: args.userIds }).userIds)).id
    : await resolveConversationId(args);
  const message = unwrap(await sendMessage(meId, conversationId, body.text, body.parentId));
  return { conversationId, message: formatMessage(message, await namesFor([meId])) };
}

export async function runReactToChatMessage(ctx: McpCtx, args: { messageId?: string; emoji?: string }) {
  const meId = await requireChat(ctx);
  if (!args.messageId) throw new McpInvalidError("messageId is required");
  const { emoji } = parse(reactionSchema, { emoji: args.emoji });
  const message = unwrap(await toggleReaction(meId, args.messageId, emoji));
  const reacted = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(meId));
  const names = await namesFor(message.reactions.flatMap((r) => r.userIds));
  return { reacted, message: formatMessage(message, names) };
}

const MANAGE_ACTIONS = ["create_channel", "open_dm", "join", "leave", "add_members", "mark_read"] as const;

const ACTION_REQUIRED: Record<string, string[]> = {
  create_channel: ["name"],
  open_dm: ["userIds"],
  join: [],
  leave: [],
  add_members: ["userIds"],
  mark_read: [],
};

async function summarize(c: WireConversation, meId: string) {
  const names = await namesFor(c.memberIds);
  return {
    id: c.id,
    kind: c.kind,
    title: conversationTitle(c, meId, names),
    topic: c.topic,
    isPrivate: c.isPrivate,
    members: c.memberIds.map((id) => ({ id, name: names.get(id) ?? "Unknown" })),
  };
}

export async function runManageChatConversation(ctx: McpCtx, args: Record<string, unknown>) {
  const meId = await requireChat(ctx);
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);
  switch (action) {
    case "create_channel": {
      const input = parse(createChannelSchema, {
        name: args.name,
        topic: args.topic,
        isPrivate: args.isPrivate ?? false,
        memberIds: args.userIds ?? [],
      });
      const { conversation } = unwrap(await createChannel(meId, input));
      return { conversation: await summarize(conversation, meId) };
    }
    case "open_dm": {
      const { userIds } = parse(openDmSchema, { userIds: args.userIds });
      return { conversation: await summarize(unwrap(await openDirectMessage(meId, userIds)), meId) };
    }
    case "join": {
      const { conversation } = unwrap(await joinChannel(meId, await resolveConversationId(args)));
      return { conversation: await summarize(conversation, meId) };
    }
    case "leave": {
      const conversationId = await resolveConversationId(args);
      unwrap(await leaveChannel(meId, conversationId));
      return { ok: true, conversationId };
    }
    case "add_members": {
      const { userIds } = parse(membersSchema, { userIds: args.userIds });
      const { conversation } = unwrap(await inviteMembers(meId, await resolveConversationId(args), userIds));
      return { conversation: await summarize(conversation, meId) };
    }
    case "mark_read": {
      const conversationId = await resolveConversationId(args);
      unwrap(await markRead(meId, conversationId, new Date()));
      return { ok: true, conversationId };
    }
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const LIST_CHAT_CONVERSATIONS_TOOL = {
  name: "list_chat_conversations",
  description:
    "List the member's DALI OS chat conversations (channels, DMs and group DMs), newest activity first, " +
    "with unread counts and the latest message. Pass includeBrowsable to also list public channels they haven't joined.",
  inputSchema: {
    type: "object" as const,
    properties: {
      includeBrowsable: { type: "boolean", description: "Also include public channels the member hasn't joined." },
      unreadOnly: { type: "boolean", description: "Only conversations with unread messages." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const READ_CHAT_MESSAGES_TOOL = {
  name: "read_chat_messages",
  description:
    "Read messages in a DALI OS chat conversation (oldest first), with reply counts and reactions. " +
    "Pass threadId to read one thread's replies, or before (from nextBefore) to page back.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...TARGET_PROPS,
      threadId: { type: "string", description: "Root message id; returns that message and its replies." },
      before: { type: "string", description: "ISO timestamp; return messages older than this." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Max top-level messages (default ${DEFAULT_LIMIT}).` },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const SEND_CHAT_MESSAGE_TOOL = {
  name: "send_chat_message",
  description:
    "Send a DALI OS chat message as the member. Target exactly one of: conversationId, channel (by name), " +
    "or userIds (opens or reuses the DM with exactly those people; find ids with search_directory). " +
    "Pass threadId to reply in a thread. Mention people with @handle.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...TARGET_PROPS,
      userIds: { type: "array", items: { type: "string" }, maxItems: 8, description: "DM recipients' user ids." },
      text: { type: "string", maxLength: 4000, description: "Message text." },
      threadId: { type: "string", description: "Root message id to reply to." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const REACT_TO_CHAT_MESSAGE_TOOL = {
  name: "react_to_chat_message",
  description: "Toggle the member's emoji reaction on a DALI OS chat message (adds it, or removes it if already there).",
  inputSchema: {
    type: "object" as const,
    properties: {
      messageId: { type: "string", description: "Message id." },
      emoji: { type: "string", description: "A single emoji, e.g. 👍." },
    },
    required: ["messageId", "emoji"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const MANAGE_CHAT_CONVERSATION_TOOL = {
  name: "manage_chat_conversation",
  description: `Manage DALI OS chat conversations. Pass \`action\`:
- \`create_channel\`: create a channel the member joins. Requires: name. Optional: topic, isPrivate, userIds (people to add).
- \`open_dm\`: open (or reuse) a DM or group DM. Requires: userIds.
- \`join\`: join a public channel. Requires: conversationId or channel.
- \`leave\`: leave a channel (not #general or DMs). Requires: conversationId or channel.
- \`add_members\`: add people to a conversation the member is in. Requires: conversationId or channel, userIds.
- \`mark_read\`: mark a conversation read up to now. Requires: conversationId or channel.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...MANAGE_ACTIONS], description: "Operation to perform." },
      ...TARGET_PROPS,
      name: { type: "string", description: "create_channel: channel name (lowercased, spaces become dashes)." },
      topic: { type: "string", description: "create_channel: optional topic." },
      isPrivate: { type: "boolean", description: "create_channel: private channels are invite-only (default false)." },
      userIds: { type: "array", items: { type: "string" }, description: "People to add (create_channel, add_members) or DM (open_dm)." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const CHAT_TOOLS: McpTool[] = [
  {
    def: LIST_CHAT_CONVERSATIONS_TOOL,
    run: (ctx, args) => runListChatConversations(ctx, args as { includeBrowsable?: boolean; unreadOnly?: boolean }),
  },
  {
    def: READ_CHAT_MESSAGES_TOOL,
    run: (ctx, args) =>
      runReadChatMessages(ctx, args as { conversationId?: string; channel?: string; threadId?: string; before?: string; limit?: number }),
  },
  {
    def: SEND_CHAT_MESSAGE_TOOL,
    run: (ctx, args) =>
      runSendChatMessage(ctx, args as { conversationId?: string; channel?: string; userIds?: string[]; text?: string; threadId?: string }),
  },
  {
    def: REACT_TO_CHAT_MESSAGE_TOOL,
    run: (ctx, args) => runReactToChatMessage(ctx, args as { messageId?: string; emoji?: string }),
  },
  { def: MANAGE_CHAT_CONVERSATION_TOOL, run: (ctx, args) => runManageChatConversation(ctx, args) },
];
