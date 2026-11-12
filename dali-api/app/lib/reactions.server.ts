import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { getDownloadUrl, isS3Configured } from "~/lib/s3.server";
import { customEmojiName, hasRoomForReaction } from "~/lib/reactions";

// Built with the constructor: the `v` flag is newer than the compile target.
const STANDARD_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

export function isStandardEmoji(value: string): boolean {
  return STANDARD_EMOJI.test(value);
}

const EMOJI_URL_WINDOW_S = 3600;

// A picker can show dozens of these, so each gets a cacheable S3 link rather
// than one session-checked redirect per image. Local dev has no S3.
async function emojiImageUrl(key: string) {
  if (!isS3Configured()) return `/api/upload/raw?key=${encodeURIComponent(key)}`;
  return getDownloadUrl(key, { cacheFor: EMOJI_URL_WINDOW_S });
}

/** The status to refuse a new reaction with, or null when it can be added. */
export async function reactionRefusal(emoji: string, used: string[]): Promise<400 | 409 | null> {
  const name = customEmojiName(emoji);
  const valid = name
    ? (await prisma.customEmoji.count({ where: { name, deletedAt: null } })) > 0
    : isStandardEmoji(emoji);
  if (!valid) return 400;
  return hasRoomForReaction(used, emoji) ? null : 409;
}

export type ReactionStore = {
  remove: () => Promise<number>;
  usedEmoji: () => Promise<string[]>;
  add: () => Promise<unknown>;
};

export function commentReactionStore(commentId: string, userId: string, emoji: string): ReactionStore {
  const mine = { commentId, userId, emoji };
  return {
    remove: async () => (await prisma.docCommentReaction.deleteMany({ where: mine })).count,
    usedEmoji: async () =>
      (
        await prisma.docCommentReaction.findMany({
          where: { commentId },
          select: { emoji: true },
          distinct: ["emoji"],
        })
      ).map((r) => r.emoji),
    add: () =>
      prisma.docCommentReaction.upsert({
        where: { commentId_userId_emoji: mine },
        create: mine,
        update: {},
      }),
  };
}

export async function addReaction(store: ReactionStore, emoji: string): Promise<400 | 409 | null> {
  const refused = await reactionRefusal(emoji, await store.usedEmoji());
  if (refused) return refused;
  await store.add();
  return null;
}

export async function toggleReaction(
  store: ReactionStore,
  emoji: string,
): Promise<"removed" | "added" | 400 | 409> {
  if ((await store.remove()) > 0) return "removed";
  return (await addReaction(store, emoji)) ?? "added";
}

/** Fills in each custom reaction's image, or null when the emoji was deleted. */
export async function withEmojiImages<T extends { reactions: { emoji: string; imageUrl?: string | null }[] }>(
  items: T[],
): Promise<T[]> {
  const names = new Set(
    items.flatMap((item) => item.reactions.flatMap((r) => customEmojiName(r.emoji) ?? [])),
  );
  if (names.size === 0) return items;
  const rows = await prisma.customEmoji.findMany({
    where: { name: { in: [...names] }, deletedAt: null },
    select: { name: true, imageKey: true },
  });
  const urls = new Map(
    await Promise.all(rows.map(async (r) => [r.name, await emojiImageUrl(r.imageKey)] as const)),
  );
  return items.map((item) => ({
    ...item,
    reactions: item.reactions.map((r) => {
      const name = customEmojiName(r.emoji);
      return name ? { ...r, imageUrl: urls.get(name) ?? null } : r;
    }),
  }));
}

export type CustomEmojiItem = {
  id: string;
  name: string;
  imageUrl: string;
  addedBy: string | null;
  canDelete: boolean;
};

export async function listCustomEmoji(viewer: { userId: string; core: boolean }) {
  const rows = await prisma.customEmoji.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      imageKey: true,
      addedById: true,
      addedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return Promise.all(
    rows.map(
      async (r): Promise<CustomEmojiItem> => ({
        id: r.id,
        name: r.name,
        imageUrl: await emojiImageUrl(r.imageKey),
        addedBy: r.addedBy ? fullName(r.addedBy) : null,
        canDelete: viewer.core || r.addedById === viewer.userId,
      }),
    ),
  );
}
