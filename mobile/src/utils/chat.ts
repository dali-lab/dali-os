import type { Conversation, Message } from '../types/chat';
import type { User } from '../types/user';
import { toMs } from './time';

export function conversationTitle(conversation: Conversation, users: User[], meId: string): string {
  if (conversation.kind === 'channel') return conversation.name ?? 'channel';
  const others = conversation.memberIds.
  filter((id) => id !== meId).
  map((id) => users.find((u) => u.id === id)).
  filter((u): u is User => Boolean(u));
  if (others.length === 0) return 'You';
  if (others.length === 1) return others[0].name;
  return others.map((u) => u.name.split(' ')[0]).join(', ');
}

export function rootMessages(messages: Message[], conversationId: string): Message[] {
  return messages.
  filter((m) => m.conversationId === conversationId && !m.parentId).
  sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
}

export function threadReplies(messages: Message[], parentId: string): Message[] {
  return messages.
  filter((m) => m.parentId === parentId).
  sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
}

export function lastRootMessage(messages: Message[], conversationId: string): Message | undefined {
  const roots = rootMessages(messages, conversationId).filter((m) => m.kind !== 'system');
  return roots[roots.length - 1];
}

export function unreadCount(conversation: Conversation, messages: Message[], meId: string): number {
  if (!conversation.memberIds.includes(meId)) return 0;
  const lastRead = toMs(conversation.lastReadAt);
  return messages.filter(
    (m) =>
    m.conversationId === conversation.id &&
    !m.parentId &&
    m.kind !== 'system' &&
    m.authorId !== meId &&
    toMs(m.createdAt) > lastRead
  ).length;
}

export function toChannelSlug(value: string): string {
  return value.
  toLowerCase().
  replace(/[^a-z0-9-_\s]/g, '').
  trim().
  replace(/\s+/g, '-').
  slice(0, 40);
}