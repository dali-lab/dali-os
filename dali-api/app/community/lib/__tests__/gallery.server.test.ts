import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  galleryPost: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  galleryReaction: { deleteMany: vi.fn(), upsert: vi.fn() },
  galleryComment: { create: vi.fn(), deleteMany: vi.fn() },
  galleryReport: { upsert: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db", () => ({ prisma: db }));
vi.mock("~/lib/notify.server", () => ({ notify }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => null) }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/community/lib/community.server", () => ({ requireCommunityViewer: vi.fn() }));

import {
  countNewerPosts,
  galleryAction,
  loadGalleryPage,
  parseFeedQuery,
  visibleTo,
  type GalleryViewer,
} from "../gallery.server";
import { GALLERY_PAGE_SIZE } from "../gallery";

const member: GalleryViewer = { id: "me", core: false, name: "Maya Chen" };
const core: GalleryViewer = { id: "core1", core: true, name: "Core Person" };
const UUID = "0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10";

function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://x/community/gallery", { method: "POST", body: form });
}

async function run(fields: Record<string, string>, viewer = member) {
  const res = await galleryAction(post(fields), viewer);
  // data() wraps failures; successes are plain objects.
  return "init" in (res as object)
    ? { status: (res as { init: { status: number } }).init.status, ...(res as { data: object }).data }
    : { status: 200, ...(res as object) };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.galleryPost.findFirst.mockResolvedValue({ id: "p1", authorId: "author", caption: "Demo day" });
  db.galleryReaction.deleteMany.mockResolvedValue({ count: 0 });
  db.galleryReport.count.mockResolvedValue(1);
});

describe("visibleTo", () => {
  it("lets members see live posts and their own hidden ones", () => {
    expect(visibleTo(member)).toEqual({ OR: [{ hiddenAt: null }, { authorId: "me" }] });
  });

  it("shows Core everything", () => {
    expect(visibleTo(core)).toEqual({});
  });
});

describe("parseFeedQuery", () => {
  it("reads show, q and cursor", () => {
    expect(parseFeedQuery(new URL("http://x/g?show=mine&q=%20demo%20&cursor=c1"))).toEqual({
      mine: true,
      q: "demo",
      cursor: "c1",
    });
    expect(parseFeedQuery(new URL("http://x/g"))).toEqual({ mine: false, q: "", cursor: null });
  });
});

describe("loadGalleryPage", () => {
  const rowFor = (id: string) => ({
    id,
    imageKey: `uploads/gallery/a/${UUID}-x.jpg`,
    width: 4,
    height: 3,
    color: "#000000",
    caption: null,
    hiddenAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    author: { id: "a", firstName: "Ann", lastName: "Lee", photoUrl: null, classYear: 2027 },
    reactions: [],
    _count: { comments: 0 },
  });

  it("filters to mine, matches every search word, and pages by cursor", async () => {
    db.galleryPost.findMany.mockResolvedValue([]);
    await loadGalleryPage(member, { mine: true, q: "demo maya", cursor: "c1" });
    const args = db.galleryPost.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([
      visibleTo(member),
      { authorId: "me" },
      ...["demo", "maya"].map((word) => ({
        OR: [
          { caption: { contains: word, mode: "insensitive" } },
          { author: { firstName: { contains: word, mode: "insensitive" } } },
          { author: { lastName: { contains: word, mode: "insensitive" } } },
        ],
      })),
    ]);
    expect(args).toMatchObject({ cursor: { id: "c1" }, skip: 1, take: GALLERY_PAGE_SIZE + 1 });
  });

  it("returns a next cursor only when there is another page", async () => {
    db.galleryPost.findMany.mockResolvedValue(
      Array.from({ length: GALLERY_PAGE_SIZE + 1 }, (_, i) => rowFor(`p${i}`)),
    );
    const full = await loadGalleryPage(member, { mine: false, q: "", cursor: null });
    expect(full.posts).toHaveLength(GALLERY_PAGE_SIZE);
    expect(full.nextCursor).toBe(`p${GALLERY_PAGE_SIZE - 1}`);

    db.galleryPost.findMany.mockResolvedValue([rowFor("only")]);
    const last = await loadGalleryPage(member, { mine: false, q: "", cursor: null });
    expect(last.nextCursor).toBeNull();
    expect(last.posts[0]).toMatchObject({
      id: "only",
      imageUrl: `/api/upload/raw?key=${encodeURIComponent(`uploads/gallery/a/${UUID}-x.jpg`)}`,
      author: { name: "Ann Lee", classYear: 2027 },
      hidden: false,
      mine: false,
      canModerate: false,
    });
  });

  it("leaves out the post a closeup is showing", async () => {
    db.galleryPost.findMany.mockResolvedValue([]);
    await loadGalleryPage(member, { mine: false, q: "", cursor: null, excludeId: "p9" });
    expect(db.galleryPost.findMany.mock.calls[0][0].where.AND).toContainEqual({ id: { not: "p9" } });
  });
});

describe("countNewerPosts", () => {
  it("counts visible posts after the reader's newest", async () => {
    const since = new Date("2026-10-22T12:00:00Z");
    await countNewerPosts(member, since);
    expect(db.galleryPost.count).toHaveBeenCalledWith({
      where: { AND: [visibleTo(member), { createdAt: { gt: since } }] },
    });
  });
});

describe("galleryAction create", () => {
  const photo = (caption: string) => ({
    imageKey: `uploads/gallery/me/${UUID}-a.jpg`,
    width: 10,
    height: 20,
    color: "#112233",
    caption,
  });

  it("makes one post per photo, first photo newest", async () => {
    const res = await run({ intent: "create", posts: JSON.stringify([photo("one"), photo("two")]) });
    expect(res).toMatchObject({ ok: true, created: 2 });
    const rows = db.galleryPost.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { caption: string }) => r.caption)).toEqual(["one", "two"]);
    expect(rows.every((r: { authorId: string }) => r.authorId === "me")).toBe(true);
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(rows[1].createdAt.getTime());
  });

  it("refuses photos uploaded under someone else's prefix", async () => {
    const theirs = { ...photo("x"), imageKey: `uploads/gallery/other/${UUID}-a.jpg` };
    const res = await run({ intent: "create", posts: JSON.stringify([theirs]) });
    expect(res).toMatchObject({ status: 400, ok: false });
    expect(db.galleryPost.createMany).not.toHaveBeenCalled();
  });
});

describe("galleryAction react", () => {
  it("adds a reaction and tells the poster", async () => {
    const res = await run({ intent: "react", postId: "p1", emoji: "🔥" });
    expect(res).toMatchObject({ ok: true });
    expect(db.galleryReaction.upsert).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "gallery.reaction",
        recipients: [{ userId: "author" }],
        message: {
          vars: { personName: "Maya Chen", itemDetail: '🔥 "Demo day"' },
          link: "/community/gallery/p1",
        },
      }),
    );
  });

  it("takes a reaction back without notifying", async () => {
    db.galleryReaction.deleteMany.mockResolvedValue({ count: 1 });
    await run({ intent: "react", postId: "p1", emoji: "🔥" });
    expect(db.galleryReaction.upsert).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("doesn't notify you about your own post", async () => {
    db.galleryPost.findFirst.mockResolvedValue({ id: "p1", authorId: "me", caption: null });
    await run({ intent: "react", postId: "p1", emoji: "🔥" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects an emoji outside the palette", async () => {
    expect(await run({ intent: "react", postId: "p1", emoji: "💩" })).toMatchObject({ status: 400 });
  });

  it("404s on a post the viewer can't see", async () => {
    db.galleryPost.findFirst.mockResolvedValue(null);
    expect(await run({ intent: "react", postId: "p1", emoji: "🔥" })).toMatchObject({ status: 404 });
  });
});

describe("galleryAction comment", () => {
  it("saves the comment and notifies the poster with its text", async () => {
    await run({ intent: "comment", postId: "p1", body: "  great shot  " });
    expect(db.galleryComment.create).toHaveBeenCalledWith({
      data: { postId: "p1", authorId: "me", body: "great shot" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "gallery.comment",
        message: { vars: { personName: "Maya Chen", itemDetail: "great shot" }, link: "/community/gallery/p1" },
      }),
    );
  });

  it("rejects an empty or overlong comment", async () => {
    expect(await run({ intent: "comment", postId: "p1", body: "  " })).toMatchObject({ status: 400 });
    expect(await run({ intent: "comment", postId: "p1", body: "x".repeat(1001) })).toMatchObject({
      status: 400,
    });
  });

  it("lets members delete only their own comments and Core any", async () => {
    await run({ intent: "delete-comment", commentId: "c1" });
    expect(db.galleryComment.deleteMany).toHaveBeenLastCalledWith({ where: { id: "c1", authorId: "me" } });
    await run({ intent: "delete-comment", commentId: "c1" }, core);
    expect(db.galleryComment.deleteMany).toHaveBeenLastCalledWith({ where: { id: "c1" } });
  });
});

describe("galleryAction moderation", () => {
  it("deletes only the viewer's own post, Core included", async () => {
    await run({ intent: "delete", postId: "p1" }, core);
    expect(db.galleryPost.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", authorId: "core1" } });
  });

  it("records a report without hiding below the threshold", async () => {
    await run({ intent: "report", postId: "p1", reason: "spam" });
    expect(db.galleryReport.upsert).toHaveBeenCalledWith({
      where: { postId_reporterId: { postId: "p1", reporterId: "me" } },
      create: { postId: "p1", reporterId: "me", reason: "spam" },
      update: { reason: "spam" },
    });
    expect(db.galleryPost.updateMany).not.toHaveBeenCalled();
  });

  it("hides the post at the second report", async () => {
    db.galleryReport.count.mockResolvedValue(2);
    await run({ intent: "report", postId: "p1" });
    expect(db.galleryPost.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", hiddenAt: null },
      data: { hiddenAt: expect.any(Date) },
    });
  });

  it("won't let you report your own post", async () => {
    db.galleryPost.findFirst.mockResolvedValue({ id: "p1", authorId: "me", caption: null });
    expect(await run({ intent: "report", postId: "p1" })).toMatchObject({ status: 404 });
    expect(db.galleryReport.upsert).not.toHaveBeenCalled();
  });

  it("keeps hide and restore to Core", async () => {
    expect(await run({ intent: "hide", postId: "p1" })).toMatchObject({ status: 403 });
    expect(await run({ intent: "restore", postId: "p1" })).toMatchObject({ status: 403 });
    expect(db.galleryPost.updateMany).not.toHaveBeenCalled();
  });

  it("records which Core member hid a post", async () => {
    await run({ intent: "hide", postId: "p1" }, core);
    expect(db.galleryPost.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", hiddenAt: null },
      data: { hiddenAt: expect.any(Date), hiddenById: "core1" },
    });
  });

  it("clears the reports on restore so the next one doesn't re-hide it", async () => {
    await run({ intent: "restore", postId: "p1" }, core);
    expect(db.galleryReport.deleteMany).toHaveBeenCalledWith({ where: { postId: "p1" } });
    expect(db.galleryPost.updateMany).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { hiddenAt: null, hiddenById: null },
    });
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    expect(await run({ intent: "pin", postId: "p1" })).toMatchObject({ status: 400 });
  });
});
