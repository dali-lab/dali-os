import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  blogPost: { findFirst: vi.fn() },
  blogReaction: {
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(async (): Promise<unknown[]> => []),
  },
  blogComment: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
  customEmoji: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
}));
const notify = vi.hoisted(() => vi.fn());
const mentions = vi.hoisted(() => ({
  extractHandlesFromText: vi.fn((text: string) =>
    [...text.matchAll(/@([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
  ),
  resolveHandles: vi.fn(async (_handles: string[]): Promise<string[]> => []),
  notifyMentions: vi.fn(),
}));
const rateLimit = vi.hoisted(() => vi.fn((): unknown => null));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/notify.server", () => ({ notify }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (url: string | null) => url) }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: () => false, getDownloadUrl: vi.fn() }));
vi.mock("~/lib/mentions.server", () => mentions);
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));

import {
  blogEngagementAction,
  loadBlogEngagement,
  type BlogReader,
} from "../blog-engagement.server";

const member: BlogReader = { id: "me", core: false, name: "Ada Lovelace" };
const core: BlogReader = { id: "core1", core: true, name: "Grace Hopper" };

async function run(fields: Record<string, string>, viewer = member) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request("http://x/resources/blog/p1", { method: "POST", body: form });
  const res = await blogEngagementAction(request, viewer, "p1");
  // data() wraps failures; successes are plain objects.
  return "init" in (res as object)
    ? { status: (res as { init: { status: number } }).init.status }
    : { status: 200, ...(res as object) };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.blogPost.findFirst.mockResolvedValue({ authorId: "author", title: "Demo day" });
  db.blogReaction.deleteMany.mockResolvedValue({ count: 0 });
  db.blogReaction.findMany.mockResolvedValue([]);
  rateLimit.mockReturnValue(null);
});

describe("react", () => {
  it("adds a reaction and tells the author", async () => {
    expect(await run({ intent: "react", emoji: "🔥" })).toMatchObject({ ok: true });
    expect(db.blogReaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { postId: "p1", userId: "me", emoji: "🔥" } }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "blog.reaction",
        recipients: [{ userId: "author" }],
        message: {
          vars: { personName: "Ada Lovelace", itemDetail: '🔥 "Demo day"' },
          link: "/resources/blog/p1",
        },
      }),
    );
  });

  it("takes a reaction back without notifying", async () => {
    db.blogReaction.deleteMany.mockResolvedValue({ count: 1 });
    expect(await run({ intent: "react", emoji: "🔥" })).toMatchObject({ ok: true });
    expect(db.blogReaction.upsert).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("doesn't notify you about your own story", async () => {
    db.blogPost.findFirst.mockResolvedValue({ authorId: "me", title: "Mine" });
    await run({ intent: "react", emoji: "🔥" });
    expect(db.blogReaction.upsert).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects text that isn't one emoji", async () => {
    for (const emoji of ["hello", "🔥🔥"]) {
      expect(await run({ intent: "react", emoji })).toMatchObject({ status: 400 });
    }
    expect(db.blogReaction.upsert).not.toHaveBeenCalled();
  });

  it("refuses a 21st distinct emoji but still adds to an existing chip", async () => {
    db.blogReaction.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ emoji: i === 0 ? "🔥" : `:e${i}:` })),
    );
    expect(await run({ intent: "react", emoji: "🎉" })).toMatchObject({ status: 409 });
    expect(await run({ intent: "react", emoji: "🔥" })).toMatchObject({ ok: true });
  });

  it("only reacts to a published story", async () => {
    db.blogPost.findFirst.mockResolvedValue(null);
    expect(await run({ intent: "react", emoji: "🔥" })).toMatchObject({ status: 404 });
    expect(db.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", publishedAt: { not: null } } }),
    );
    expect(db.blogReaction.deleteMany).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    rateLimit.mockReturnValue(new Response(null, { status: 429 }));
    expect(await run({ intent: "react", emoji: "🔥" })).toMatchObject({ status: 429 });
    expect(db.blogReaction.upsert).not.toHaveBeenCalled();
  });
});

describe("comment", () => {
  it("saves the trimmed comment and notifies the author with its text", async () => {
    expect(await run({ intent: "comment", body: "  great read  " })).toMatchObject({ ok: true });
    expect(db.blogComment.create).toHaveBeenCalledWith({
      data: { postId: "p1", authorId: "me", body: "great read" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "blog.comment",
        recipients: [{ userId: "author" }],
        message: { vars: { personName: "Ada Lovelace", itemDetail: "great read" }, link: "/resources/blog/p1" },
      }),
    );
  });

  it("notifies @mentioned people, never the commenter", async () => {
    mentions.resolveHandles.mockResolvedValueOnce(["leo", "me"]);
    await run({ intent: "comment", body: "@leo look, and @ada" });
    expect(mentions.notifyMentions).toHaveBeenCalledWith({
      recipientUserIds: ["leo"],
      actorId: "me",
      link: "/resources/blog/p1",
      copyKey: "mention.comment",
      preview: "@leo look, and @ada",
    });
  });

  it("sends a mentioned author only the mention", async () => {
    mentions.resolveHandles.mockResolvedValueOnce(["author"]);
    await run({ intent: "comment", body: "@ann nice" });
    expect(notify).not.toHaveBeenCalled();
    expect(mentions.notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["author"] }),
    );
  });

  it("doesn't notify you about your own story", async () => {
    db.blogPost.findFirst.mockResolvedValue({ authorId: "me", title: "Mine" });
    await run({ intent: "comment", body: "thanks all" });
    expect(db.blogComment.create).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects an empty or overlong comment", async () => {
    expect(await run({ intent: "comment", body: "  " })).toMatchObject({ status: 400 });
    expect(await run({ intent: "comment", body: "x".repeat(1001) })).toMatchObject({ status: 400 });
    expect(db.blogComment.create).not.toHaveBeenCalled();
  });

  it("only comments on a published story", async () => {
    db.blogPost.findFirst.mockResolvedValue(null);
    expect(await run({ intent: "comment", body: "hi" })).toMatchObject({ status: 404 });
    expect(db.blogComment.create).not.toHaveBeenCalled();
  });

  it("lets members delete only their own comments on this story and Core any", async () => {
    await run({ intent: "delete-comment", commentId: "c1" });
    expect(db.blogComment.deleteMany).toHaveBeenLastCalledWith({
      where: { id: "c1", postId: "p1", authorId: "me" },
    });
    await run({ intent: "delete-comment", commentId: "c1" }, core);
    expect(db.blogComment.deleteMany).toHaveBeenLastCalledWith({ where: { id: "c1", postId: "p1" } });
  });
});

it("rejects an unknown intent", async () => {
  expect(await run({ intent: "publish" })).toMatchObject({ status: 400 });
});

describe("loadBlogEngagement", () => {
  it("summarizes reactions and lists comments oldest first with who can delete them", async () => {
    const at = new Date("2026-11-01T12:00:00Z");
    db.blogReaction.findMany.mockResolvedValue([
      { emoji: "🔥", userId: "me", createdAt: at, user: { firstName: "Ada", lastName: "Lovelace" } },
      { emoji: "🔥", userId: "u2", createdAt: at, user: { firstName: "Leo", lastName: "Bell" } },
    ]);
    db.blogComment.findMany.mockResolvedValue([
      { id: "c1", body: "mine", createdAt: at, author: { id: "me", firstName: "Ada", lastName: "Lovelace", photoUrl: "a.png" } },
      { id: "c2", body: "theirs", createdAt: at, author: { id: "u2", firstName: "Leo", lastName: "Bell", photoUrl: null } },
    ]);
    const result = await loadBlogEngagement(member, "p1");
    expect(db.blogComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: "p1" }, orderBy: { createdAt: "asc" } }),
    );
    expect(result.reactions).toEqual([{ emoji: "🔥", count: 2, mine: true, people: ["Leo Bell"] }]);
    expect(result.comments).toEqual([
      { id: "c1", body: "mine", createdAt: at.toISOString(), author: { name: "Ada Lovelace", photoUrl: "a.png" }, canDelete: true },
      { id: "c2", body: "theirs", createdAt: at.toISOString(), author: { name: "Leo Bell", photoUrl: null }, canDelete: false },
    ]);
    expect((await loadBlogEngagement(core, "p1")).comments.every((c) => c.canDelete)).toBe(true);
  });
});
