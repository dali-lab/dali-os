import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
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
const mentions = vi.hoisted(() => ({
  extractHandlesFromText: vi.fn((text: string) =>
    [...text.matchAll(/@([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
  ),
  resolveHandles: vi.fn(async (_handles: string[]): Promise<string[]> => []),
  notifyMentions: vi.fn(),
}));
const s3 = vi.hoisted(() => ({
  isS3Configured: vi.fn(() => false),
  getDownloadUrl: vi.fn(async (key: string) => `https://s3.test/${key}`),
}));

vi.mock("~/lib/db", () => ({ prisma: db }));
vi.mock("~/lib/notify.server", () => ({ notify }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => null) }));
vi.mock("~/lib/s3", () => s3);
vi.mock("~/lib/mentions", () => mentions);
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/community/lib/community.server", () => ({ requireCommunityViewer: vi.fn() }));

import {
  countNewerPosts,
  galleryAction,
  galleryDownloadUrl,
  loadGalleryPerson,
  searchGalleryPeople,
  loadGalleryPage,
  loadGalleryPost,
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
  s3.isS3Configured.mockReturnValue(false);
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
      by: null,
      q: "demo",
      cursor: "c1",
    });
    expect(parseFeedQuery(new URL("http://x/g?by=u7"))).toEqual({
      mine: false,
      by: "u7",
      q: "",
      cursor: null,
    });
  });
});

const rowFor = (id: string, thumbKey: string | null = null, displayKey: string | null = null) => ({
  id,
  imageKey: `uploads/gallery/a/${UUID}-x.jpg`,
  displayKey,
  thumbKey,
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

describe("loadGalleryPage", () => {
  it("filters to mine, matches every search word, and pages by cursor", async () => {
    db.galleryPost.findMany.mockResolvedValue([]);
    await loadGalleryPage(member, { by: null, mine: true, q: "demo maya", cursor: "c1" });
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
    const full = await loadGalleryPage(member, { by: null, mine: false, q: "", cursor: null });
    expect(full.posts).toHaveLength(GALLERY_PAGE_SIZE);
    expect(full.nextCursor).toBe(`p${GALLERY_PAGE_SIZE - 1}`);

    db.galleryPost.findMany.mockResolvedValue([rowFor("only")]);
    const last = await loadGalleryPage(member, { by: null, mine: false, q: "", cursor: null });
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

  it("signs a cacheable link to the thumbnail when there is one", async () => {
    s3.isS3Configured.mockReturnValue(true);
    const thumb = `uploads/gallery/a/${UUID}-thumb.webp`;
    db.galleryPost.findMany.mockResolvedValue([rowFor("t", thumb), rowFor("o")]);
    const { posts } = await loadGalleryPage(member, { by: null, mine: false, q: "", cursor: null });
    expect(posts.map((p) => p.imageUrl)).toEqual([
      `https://s3.test/${thumb}`,
      `https://s3.test/uploads/gallery/a/${UUID}-x.jpg`,
    ]);
    expect(s3.getDownloadUrl).toHaveBeenCalledWith(thumb, { cacheFor: 3600 });
  });

  it("falls back to the display copy, then the original, when a tile has no thumbnail", async () => {
    s3.isS3Configured.mockReturnValue(true);
    const display = `uploads/gallery/a/${UUID}-display.webp`;
    db.galleryPost.findMany.mockResolvedValue([rowFor("d", null, display), rowFor("o")]);
    const { posts } = await loadGalleryPage(member, { by: null, mine: false, q: "", cursor: null });
    expect(posts.map((p) => p.imageUrl)).toEqual([
      `https://s3.test/${display}`,
      `https://s3.test/uploads/gallery/a/${UUID}-x.jpg`,
    ]);
  });

  it("leaves out the post a closeup is showing", async () => {
    db.galleryPost.findMany.mockResolvedValue([]);
    await loadGalleryPage(member, { by: null, mine: false, q: "", cursor: null, excludeId: "p9" });
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

  it("stores the original, display copy and tile keys the composer uploaded", async () => {
    const keys = {
      imageKey: `uploads/gallery-originals/me/${UUID}-a.jpg`,
      displayKey: `uploads/gallery/me/${UUID}-display.webp`,
      thumbKey: `uploads/gallery/me/${UUID}-thumb.webp`,
    };
    const res = await run({ intent: "create", posts: JSON.stringify([{ ...photo("x"), ...keys }]) });
    expect(res).toMatchObject({ ok: true, created: 1 });
    expect(db.galleryPost.createMany.mock.calls[0][0].data[0]).toMatchObject(keys);
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

  it("notifies @mentioned people with the shared mention event", async () => {
    mentions.resolveHandles.mockResolvedValueOnce(["leo", "me"]);
    await run({ intent: "comment", postId: "p1", body: "@leo_b look, and @maya" });
    expect(mentions.resolveHandles).toHaveBeenCalledWith(["leo_b", "maya"]);
    expect(mentions.notifyMentions).toHaveBeenCalledWith({
      recipientUserIds: ["leo"],
      actorId: "me",
      link: "/community/gallery/p1",
      copyKey: "mention.comment",
      preview: "@leo_b look, and @maya",
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "gallery.comment" }));
  });

  it("sends a mentioned poster only the mention", async () => {
    mentions.resolveHandles.mockResolvedValueOnce(["author"]);
    await run({ intent: "comment", postId: "p1", body: "@ann nice" });
    expect(notify).not.toHaveBeenCalled();
    expect(mentions.notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["author"] }),
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

describe("loadGalleryPost", () => {
  it("gives the closeup the display copy, not the original", async () => {
    s3.isS3Configured.mockReturnValue(true);
    const display = `uploads/gallery/a/${UUID}-display.webp`;
    db.galleryPost.findFirst.mockResolvedValue({ ...rowFor("p1", null, display), comments: [], reports: [] });
    expect((await loadGalleryPost(member, "p1"))?.fullImageUrl).toBe(`https://s3.test/${display}`);
  });

  it("gives the closeup the original when there's no display copy, and keeps the thumbnail for its placeholder", async () => {
    s3.isS3Configured.mockReturnValue(true);
    const thumb = `uploads/gallery/a/${UUID}-thumb.webp`;
    db.galleryPost.findFirst.mockResolvedValue({ ...rowFor("p1", thumb), comments: [], reports: [] });
    const post = await loadGalleryPost(member, "p1");
    expect(post).toMatchObject({
      imageUrl: `https://s3.test/${thumb}`,
      fullImageUrl: `https://s3.test/uploads/gallery/a/${UUID}-x.jpg`,
    });
  });
});

describe("person filter", () => {
  it("narrows the feed to one author", async () => {
    db.galleryPost.findMany.mockResolvedValue([]);
    await loadGalleryPage(member, { mine: false, by: "u7", q: "", cursor: null });
    expect(db.galleryPost.findMany.mock.calls[0][0].where.AND).toEqual([
      visibleTo(member),
      { authorId: "u7" },
    ]);
  });
});

const ann = { id: "a", firstName: "Ann", lastName: "Lee", photoUrl: null, classYear: 2027 };

describe("searchGalleryPeople", () => {
  it("finds people matching every word who have a post the viewer can see", async () => {
    db.user.findMany.mockResolvedValue([{ ...ann, _count: { galleryPosts: 3 } }]);
    const people = await searchGalleryPeople(member, " ann  le ");
    const args = db.user.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([
      { galleryPosts: { some: visibleTo(member) } },
      ...["ann", "le"].map((word) => ({
        OR: [
          { firstName: { contains: word, mode: "insensitive" } },
          { lastName: { contains: word, mode: "insensitive" } },
        ],
      })),
    ]);
    expect(args.take).toBe(5);
    expect(args.select._count).toEqual({ select: { galleryPosts: { where: visibleTo(member) } } });
    expect(people).toEqual([{ id: "a", name: "Ann Lee", classYear: 2027, photoUrl: null, postCount: 3 }]);
  });

  it("skips the query for a blank search", async () => {
    expect(await searchGalleryPeople(member, "   ")).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("loadGalleryPerson", () => {
  it("returns the person with their visible post count", async () => {
    db.user.findUnique.mockResolvedValue({ ...ann, _count: { galleryPosts: 18 } });
    expect(await loadGalleryPerson(core, "a")).toMatchObject({ id: "a", name: "Ann Lee", postCount: 18 });
    expect(db.user.findUnique.mock.calls[0][0].select._count).toEqual({
      select: { galleryPosts: { where: visibleTo(core) } },
    });
  });

  it("is null for an unknown id", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await loadGalleryPerson(member, "nope")).toBeNull();
  });
});

describe("galleryDownloadUrl", () => {
  const key = `uploads/gallery/a/${UUID}-IMG_1.jpg`;

  it("signs the original as an attachment named after the caption", async () => {
    s3.isS3Configured.mockReturnValue(true);
    db.galleryPost.findFirst.mockResolvedValue({ imageKey: key, caption: "Demo day" });
    expect(await galleryDownloadUrl(member, "p1")).toBe(`https://s3.test/${key}`);
    expect(s3.getDownloadUrl).toHaveBeenCalledWith(key, { fileName: "gallery-demo-day.jpg" });
    expect(db.galleryPost.findFirst.mock.calls[0][0].where).toEqual({
      AND: [{ id: "p1" }, visibleTo(member)],
    });
  });

  it("is null for a post the viewer can't see", async () => {
    db.galleryPost.findFirst.mockResolvedValue(null);
    expect(await galleryDownloadUrl(member, "p1")).toBeNull();
  });

  it("falls back to the redirect route without S3", async () => {
    db.galleryPost.findFirst.mockResolvedValue({ imageKey: key, caption: null });
    expect(await galleryDownloadUrl(member, "p1")).toBe(
      `/api/upload/raw?key=${encodeURIComponent(key)}`,
    );
  });
});
