import { prisma } from "~/lib/db";
import {
  DEFAULT_CHANNELS,
  MESSAGE_PAGE_SIZE,
  addedMembersText,
  canInvite,
  canJoin,
  canLeave,
  canPost,
  canView,
  dmMemberKey,
  dmMemberSet,
  groupReactions,
  nextReadMarker,
} from "./chat-rules";
import { publishChatEvent, type ChatStreamEvent } from "./chat-stream.server";
import { sendChatPush } from "./chat-push.server";

export interface WireConversation {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  isPrivate: boolean;
  isDefault: boolean;
  topic: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  lastReadAt: string;
}

export interface WireMessage {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  createdAt: string;
  reactions: { emoji: string; userIds: string[] }[];
  parentId: string | null;
  kind: "user" | "system";
}

export type ChatResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ChatResult<never> => ({ ok: false, status, error });
const NOT_FOUND = fail(404, "Conversation not found");

const conversationInclude = { members: { select: { userId: true, lastReadAt: true } } } as const;
const messageInclude = { reactions: { select: { emoji: true, userId: true, createdAt: true } } } as const;

type ConversationRow = {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  isPrivate: boolean;
  isDefault: boolean;
  topic: string | null;
  createdById: string;
  createdAt: Date;
  members: { userId: string; lastReadAt: Date }[];
};

type MessageRow = {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  createdAt: Date;
  parentId: string | null;
  kind: "user" | "system";
  reactions: { emoji: string; userId: string; createdAt: Date }[];
};

export function toWireConversation(c: ConversationRow, meId: string): WireConversation {
  const mine = c.members.find((m) => m.userId === meId);
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    isPrivate: c.isPrivate,
    isDefault: c.isDefault,
    topic: c.topic,
    memberIds: c.members.map((m) => m.userId),
    createdBy: c.createdById,
    createdAt: c.createdAt.toISOString(),
    lastReadAt: (mine?.lastReadAt ?? c.createdAt).toISOString(),
  };
}

export function toWireMessage(m: MessageRow): WireMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    authorId: m.authorId,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    reactions: groupReactions(m.reactions),
    parentId: m.parentId,
    kind: m.kind,
  };
}

async function loadConversation(id: string): Promise<ConversationRow | null> {
  return prisma.chatConversation.findUnique({ where: { id }, include: conversationInclude });
}

function isMemberOf(c: ConversationRow, userId: string) {
  return c.members.some((m) => m.userId === userId);
}

function notify(c: ConversationRow, event: ChatStreamEvent, extraUserIds: string[] = []) {
  publishChatEvent([...c.members.map((m) => m.userId), ...extraUserIds], event, c.id);
}

async function pageOfMessages(conversationId: string, before?: Date): Promise<WireMessage[]> {
  const roots = await prisma.chatMessage.findMany({
    where: { conversationId, parentId: null, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: MESSAGE_PAGE_SIZE,
    include: messageInclude,
  });
  if (roots.length === 0) return [];
  const replies = await prisma.chatMessage.findMany({
    where: { parentId: { in: roots.map((r) => r.id) } },
    orderBy: { createdAt: "asc" },
    include: messageInclude,
  });
  return [...roots.reverse(), ...replies].map(toWireMessage);
}

async function appendSystemMessage(conversationId: string, authorId: string, text: string) {
  return prisma.chatMessage.create({ data: { conversationId, authorId, text, kind: "system" } });
}

export async function ensureDefaultChannels(userId: string): Promise<void> {
  for (const ch of DEFAULT_CHANNELS) {
    const existing = await prisma.chatConversation.findUnique({ where: { name: ch.name }, select: { id: true } });
    const conversation =
      existing ??
      (await prisma.chatConversation.upsert({
        where: { name: ch.name },
        update: {},
        create: { kind: "channel", name: ch.name, topic: ch.topic, isDefault: true, createdById: userId },
        select: { id: true },
      }));
    await prisma.chatMember.createMany({
      data: [{ conversationId: conversation.id, userId }],
      skipDuplicates: true,
    });
  }
}

export async function bootstrap(meId: string): Promise<{ conversations: WireConversation[]; messages: WireMessage[] }> {
  await ensureDefaultChannels(meId);
  const rows = await prisma.chatConversation.findMany({
    where: {
      OR: [{ members: { some: { userId: meId } } }, { kind: "channel", isPrivate: false }],
    },
    include: conversationInclude,
    orderBy: { createdAt: "asc" },
  });
  const pages = await Promise.all(rows.map((c) => pageOfMessages(c.id)));
  return { conversations: rows.map((c) => toWireConversation(c, meId)), messages: pages.flat() };
}

export async function listMessages(meId: string, conversationId: string, before?: Date): Promise<ChatResult<WireMessage[]>> {
  const c = await loadConversation(conversationId);
  if (!c || !canView(c, isMemberOf(c, meId))) return NOT_FOUND;
  return { ok: true, data: await pageOfMessages(conversationId, before) };
}

export async function sendMessage(
  meId: string,
  conversationId: string,
  text: string,
  parentId: string | null | undefined,
): Promise<ChatResult<WireMessage>> {
  const c = await loadConversation(conversationId);
  if (!c) return NOT_FOUND;
  const member = isMemberOf(c, meId);
  if (!canView(c, member)) return NOT_FOUND;
  if (!canPost(c, member)) return fail(403, "Join the channel to post");
  if (parentId) {
    const parent = await prisma.chatMessage.findUnique({
      where: { id: parentId },
      select: { conversationId: true, parentId: true },
    });
    if (!parent || parent.conversationId !== conversationId || parent.parentId) {
      return fail(400, "Invalid thread");
    }
  }
  const created = await prisma.chatMessage.create({
    data: { conversationId, authorId: meId, text, parentId: parentId ?? null },
    include: messageInclude,
  });
  await prisma.chatMember.update({
    where: { conversationId_userId: { conversationId, userId: meId } },
    data: { lastReadAt: created.createdAt },
  });
  notify(c, "message");
  void sendChatPush(
    { id: c.id, kind: c.kind, name: c.name, memberIds: c.members.map((m) => m.userId) },
    created,
  ).catch((err) => console.error("[chat-push] failed", err instanceof Error ? err.message : "unknown error"));
  return { ok: true, data: toWireMessage(created) };
}

export async function toggleReaction(meId: string, messageId: string, emoji: string): Promise<ChatResult<WireMessage>> {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { conversationId: true } });
  if (!message) return fail(404, "Message not found");
  const c = await loadConversation(message.conversationId);
  if (!c) return fail(404, "Message not found");
  const member = isMemberOf(c, meId);
  if (!canView(c, member)) return fail(404, "Message not found");
  if (!canPost(c, member)) return fail(403, "Join the channel to react");
  const key = { messageId_userId_emoji: { messageId, userId: meId, emoji } };
  const existing = await prisma.chatReaction.findUnique({ where: key, select: { id: true } });
  if (existing) {
    await prisma.chatReaction.delete({ where: key });
  } else {
    await prisma.chatReaction.create({ data: { messageId, userId: meId, emoji } });
  }
  const updated = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  notify(c, "message");
  return { ok: true, data: toWireMessage(updated) };
}

async function activeUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: ids }, membershipStatus: "Active" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function createChannel(
  meId: string,
  input: { name: string; topic: string | null; isPrivate: boolean; memberIds: string[] },
): Promise<ChatResult<{ conversation: WireConversation; messages: WireMessage[] }>> {
  const taken = await prisma.chatConversation.findUnique({ where: { name: input.name }, select: { id: true } });
  if (taken) return fail(409, `#${input.name} already exists`);
  const others = await activeUserIds(input.memberIds.filter((id) => id !== meId));
  const created = await prisma.chatConversation.create({
    data: {
      kind: "channel",
      name: input.name,
      topic: input.topic,
      isPrivate: input.isPrivate,
      createdById: meId,
      members: { create: [meId, ...others].map((userId) => ({ userId })) },
    },
    select: { id: true },
  });
  await appendSystemMessage(created.id, meId, `created #${input.name}`);
  const c = (await loadConversation(created.id))!;
  notify(c, "conversation");
  return { ok: true, data: { conversation: toWireConversation(c, meId), messages: await pageOfMessages(c.id) } };
}

export async function openDirectMessage(meId: string, userIds: string[]): Promise<ChatResult<WireConversation>> {
  const others = (await activeUserIds(userIds.filter((id) => id !== meId))).sort();
  if (others.length === 0) return fail(400, "Pick at least one person");
  const memberIds = dmMemberSet(meId, others);
  const key = dmMemberKey(memberIds);
  const candidates = await prisma.chatConversation.findMany({
    where: { kind: "dm", members: { some: { userId: meId } } },
    include: conversationInclude,
  });
  const existing = candidates.find((c) => dmMemberKey(c.members.map((m) => m.userId)) === key);
  if (existing) return { ok: true, data: toWireConversation(existing, meId) };
  const created = await prisma.chatConversation.create({
    data: {
      kind: "dm",
      isPrivate: true,
      createdById: meId,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
    include: conversationInclude,
  });
  notify(created, "conversation");
  return { ok: true, data: toWireConversation(created, meId) };
}

export async function joinChannel(
  meId: string,
  conversationId: string,
): Promise<ChatResult<{ conversation: WireConversation; messages: WireMessage[] }>> {
  const c = await loadConversation(conversationId);
  if (!c || !canView(c, isMemberOf(c, meId))) return NOT_FOUND;
  if (!canJoin(c, isMemberOf(c, meId))) return fail(400, "You can't join this conversation");
  const msg = await appendSystemMessage(conversationId, meId, "joined the channel");
  await prisma.chatMember.create({ data: { conversationId, userId: meId, lastReadAt: msg.createdAt } });
  const updated = (await loadConversation(conversationId))!;
  notify(updated, "conversation");
  return {
    ok: true,
    data: { conversation: toWireConversation(updated, meId), messages: await pageOfMessages(conversationId) },
  };
}

export async function leaveChannel(meId: string, conversationId: string): Promise<ChatResult<null>> {
  const c = await loadConversation(conversationId);
  if (!c || !canView(c, isMemberOf(c, meId))) return NOT_FOUND;
  if (!canLeave(c, isMemberOf(c, meId))) return fail(400, "You can't leave this conversation");
  await appendSystemMessage(conversationId, meId, "left the channel");
  await prisma.chatMember.delete({ where: { conversationId_userId: { conversationId, userId: meId } } });
  notify(c, "conversation");
  return { ok: true, data: null };
}

export async function inviteMembers(
  meId: string,
  conversationId: string,
  userIds: string[],
): Promise<ChatResult<{ conversation: WireConversation; messages: WireMessage[] }>> {
  const c = await loadConversation(conversationId);
  if (!c || !canView(c, isMemberOf(c, meId))) return NOT_FOUND;
  if (!canInvite(c, isMemberOf(c, meId))) return fail(403, "Only channel members can add people");
  const current = new Set(c.members.map((m) => m.userId));
  const toAdd = (await activeUserIds(userIds)).filter((id) => !current.has(id));
  if (toAdd.length > 0) {
    const people = await prisma.user.findMany({ where: { id: { in: toAdd } }, select: { id: true, firstName: true } });
    const names = toAdd.map((id) => people.find((p) => p.id === id)?.firstName ?? "someone");
    await prisma.chatMember.createMany({
      data: toAdd.map((userId) => ({ conversationId, userId })),
      skipDuplicates: true,
    });
    await appendSystemMessage(conversationId, meId, addedMembersText(names));
  }
  const updated = (await loadConversation(conversationId))!;
  notify(updated, "conversation");
  return {
    ok: true,
    data: { conversation: toWireConversation(updated, meId), messages: await pageOfMessages(conversationId) },
  };
}

export async function markRead(meId: string, conversationId: string, at: Date, now = new Date()): Promise<ChatResult<null>> {
  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: meId } },
    select: { lastReadAt: true },
  });
  if (!member) return NOT_FOUND;
  const next = nextReadMarker(member.lastReadAt, at, now);
  if (next.getTime() !== member.lastReadAt.getTime()) {
    await prisma.chatMember.update({
      where: { conversationId_userId: { conversationId, userId: meId } },
      data: { lastReadAt: next },
    });
  }
  return { ok: true, data: null };
}
