import { z } from "zod";

export interface ConversationAccess {
  kind: "channel" | "dm";
  isPrivate: boolean;
  isDefault: boolean;
}

export function isPublicChannel(c: ConversationAccess): boolean {
  return c.kind === "channel" && !c.isPrivate;
}

export function canView(c: ConversationAccess, isMember: boolean): boolean {
  return isMember || isPublicChannel(c);
}

export function canPost(_c: ConversationAccess, isMember: boolean): boolean {
  return isMember;
}

export function canJoin(c: ConversationAccess, isMember: boolean): boolean {
  return !isMember && isPublicChannel(c);
}

export function canLeave(c: ConversationAccess, isMember: boolean): boolean {
  return isMember && c.kind === "channel" && !c.isDefault;
}

export function canInvite(c: ConversationAccess, isMember: boolean): boolean {
  return isMember && c.kind === "channel";
}

export function toChannelSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export function dmMemberKey(userIds: string[]): string {
  return Array.from(new Set(userIds)).sort().join("|");
}

export function dmMemberSet(meId: string, userIds: string[]): string[] {
  return Array.from(new Set([meId, ...userIds])).sort();
}

export function nextReadMarker(current: Date, requested: Date, now: Date): Date {
  const capped = requested.getTime() > now.getTime() ? now : requested;
  return capped.getTime() > current.getTime() ? capped : current;
}

export interface ReactionRow {
  emoji: string;
  userId: string;
  createdAt: Date;
}

export function groupReactions(rows: ReactionRow[]): { emoji: string; userIds: string[] }[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const byEmoji = new Map<string, string[]>();
  for (const r of sorted) {
    const list = byEmoji.get(r.emoji) ?? [];
    if (!list.includes(r.userId)) list.push(r.userId);
    byEmoji.set(r.emoji, list);
  }
  return Array.from(byEmoji, ([emoji, userIds]) => ({ emoji, userIds }));
}

export function addedMembersText(firstNames: string[]): string {
  return `added ${firstNames.join(", ")}`;
}

export const DEFAULT_CHANNELS = [{ name: "general", topic: "Lab-wide announcements & logistics" }] as const;

export const MESSAGE_PAGE_SIZE = 100;

const messageText = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Message is empty").max(4000, "Message is too long"));

export const sendMessageSchema = z.object({
  text: messageText,
  parentId: z.string().min(1).max(100).nullish(),
});

export const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});

export const createChannelSchema = z.object({
  name: z
    .string()
    .transform(toChannelSlug)
    .pipe(z.string().min(1, "Channel name is required").max(40)),
  topic: z
    .string()
    .max(250)
    .nullish()
    .transform((t) => (t && t.trim() ? t.trim() : null)),
  isPrivate: z.boolean(),
  memberIds: z.array(z.string().min(1).max(100)).max(200).default([]),
});

export const openDmSchema = z.object({
  userIds: z.array(z.string().min(1).max(100)).min(1).max(8),
});

export const membersSchema = z.object({
  userIds: z.array(z.string().min(1).max(100)).min(1).max(200),
});

export const readSchema = z.object({
  at: z.string().datetime({ offset: true }),
});
