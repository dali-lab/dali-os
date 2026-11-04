import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  galleryPost: { findFirst: vi.fn(), findMany: vi.fn() },
  galleryComment: { findFirst: vi.fn() },
}));
const roles = vi.hoisted(() => ({
  isLabMember: vi.fn(async () => true),
  getUserRoles: vi.fn(async () => ({ isCore: false })),
}));
const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(async () => true) }));
const s3 = vi.hoisted(() => ({
  isS3Configured: vi.fn(() => true),
  headObject: vi.fn(
    async (_key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> => ({
      sizeBytes: 1,
      contentType: "image/jpeg",
    }),
  ),
  getUploadPost: vi.fn(async (key: string) => ({ url: "https://s3.test", fields: { key } })),
}));
const gallery = vi.hoisted(() => ({
  applyGalleryIntent: vi.fn(
    async (
      _request: Request,
      _viewer: { id: string; core: boolean; name: string },
      _fields: Record<string, string>,
    ): Promise<{ ok: boolean; status?: number; error?: string; created?: number }> => ({ ok: true }),
  ),
  loadGalleryPage: vi.fn(),
  loadGalleryPost: vi.fn(),
  galleryDownloadUrl: vi.fn(async () => "https://s3.test/original"),
  visibleTo: vi.fn(() => ({ visible: true })),
}));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/roles", () => roles);
vi.mock("~/lib/feature-flags.server", () => flags);
vi.mock("~/lib/s3", () => s3);
vi.mock("~/community/lib/gallery.server", () => gallery);

import {
  CREATE_GALLERY_UPLOAD_DEF,
  GET_GALLERY_POST_DEF,
  LIST_GALLERY_POSTS_DEF,
  MANAGE_GALLERY_POST_DEF,
  runCreateGalleryUpload,
  runGetGalleryPost,
  runListGalleryPosts,
  runManageGalleryPost,
} from "../gallery";
import { COMMUNITY_TOOLS } from "..";
import type { McpCtx } from "~/mcp/registry";

const UUID = "0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10";
const ctx: McpCtx = {
  user: {
    id: "me",
    daliEmail: "ada@example.edu",
    dartmouthEmail: null,
    netId: null,
    firstName: "Ada",
    lastName: "Lovelace",
  },
  scopes: ["mcp:read", "mcp:write"],
  request: new Request("http://x/mcp", { method: "POST" }),
};
const viewer = { id: "me", core: false, name: "Ada Lovelace" };

const author = { id: "a", name: "Ann Lee", classYear: 2027, photoUrl: "https://s3.test/face" };
const tile = {
  id: "p1",
  imageUrl: "https://s3.test/thumb",
  width: 4000,
  height: 3000,
  color: "#000000",
  caption: "Demo day",
  hidden: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  author,
  reactions: [{ emoji: "🎉", count: 1, mine: false }],
  commentCount: 1,
  mine: false,
  canModerate: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  roles.isLabMember.mockResolvedValue(true);
  roles.getUserRoles.mockResolvedValue({ isCore: false });
  flags.isFeatureEnabled.mockResolvedValue(true);
  s3.isS3Configured.mockReturnValue(true);
  s3.headObject.mockResolvedValue({ sizeBytes: 1, contentType: "image/jpeg" });
  gallery.applyGalleryIntent.mockResolvedValue({ ok: true });
  db.galleryPost.findFirst.mockResolvedValue({ authorId: "me" });
});

describe("registration", () => {
  it("lists all four tools with read for reads and write for writes", () => {
    expect(COMMUNITY_TOOLS.map((t) => t.def.name)).toEqual([
      "list_gallery_posts",
      "get_gallery_post",
      "create_gallery_upload",
      "manage_gallery_post",
    ]);
    expect(LIST_GALLERY_POSTS_DEF.requiredScope).toBe("mcp:read");
    expect(GET_GALLERY_POST_DEF.requiredScope).toBe("mcp:read");
    expect(CREATE_GALLERY_UPLOAD_DEF.requiredScope).toBe("mcp:write");
    expect(MANAGE_GALLERY_POST_DEF.requiredScope).toBe("mcp:write");
  });
});

describe("access", () => {
  it("refuses people who aren't members or alumni", async () => {
    roles.isLabMember.mockResolvedValue(false);
    await expect(runListGalleryPosts(ctx, {})).rejects.toMatchObject({ status: 403 });
    expect(gallery.loadGalleryPage).not.toHaveBeenCalled();
  });

  it("refuses everyone while the community flag is off for them", async () => {
    flags.isFeatureEnabled.mockResolvedValue(false);
    await expect(runManageGalleryPost(ctx, { action: "react", postId: "p1", emoji: "🎉" })).rejects.toMatchObject({
      status: 403,
    });
    expect(flags.isFeatureEnabled).toHaveBeenCalledWith("community", "me", { isCore: false }, ctx.request);
    expect(gallery.applyGalleryIntent).not.toHaveBeenCalled();
  });

  it("acts as Core for Core members", async () => {
    roles.getUserRoles.mockResolvedValue({ isCore: true });
    await runManageGalleryPost(ctx, { action: "hide", postId: "p1" });
    expect(gallery.applyGalleryIntent.mock.calls[0][1]).toEqual({ ...viewer, core: true });
  });
});

describe("list_gallery_posts", () => {
  it("maps the filters onto the web feed's query and drops presentation fields", async () => {
    gallery.loadGalleryPage.mockResolvedValue({ posts: [tile], nextCursor: "p1" });
    const out = await runListGalleryPosts(ctx, { show: "mine", byUserId: "a", query: " demo ", cursor: "c1" });
    expect(gallery.loadGalleryPage).toHaveBeenCalledWith(viewer, {
      mine: true,
      by: "a",
      q: "demo",
      cursor: "c1",
    });
    expect(out.nextCursor).toBe("p1");
    expect(out.posts[0]).toEqual({
      id: "p1",
      caption: "Demo day",
      imageUrl: "https://s3.test/thumb",
      width: 4000,
      height: 3000,
      author: { id: "a", name: "Ann Lee", classYear: 2027 },
      reactions: tile.reactions,
      commentCount: 1,
      hidden: false,
      mine: false,
      createdAt: tile.createdAt,
    });
  });

  it("defaults to the whole feed", async () => {
    gallery.loadGalleryPage.mockResolvedValue({ posts: [], nextCursor: null });
    await runListGalleryPosts(ctx, {});
    expect(gallery.loadGalleryPage).toHaveBeenCalledWith(viewer, { mine: false, by: null, q: "", cursor: null });
  });
});

describe("get_gallery_post", () => {
  const detail = {
    ...tile,
    fullImageUrl: "https://s3.test/display",
    reportCount: 1,
    reportedByMe: false,
    comments: [
      { id: "c1", body: "Nice", createdAt: "2026-10-02T00:00:00.000Z", author, canDelete: false },
    ],
  };

  it("returns the display copy as imageUrl and the original as originalUrl", async () => {
    gallery.loadGalleryPost.mockResolvedValue(detail);
    const out = await runGetGalleryPost(ctx, { postId: "p1" });
    expect(out).toMatchObject({
      imageUrl: "https://s3.test/display",
      originalUrl: "https://s3.test/original",
      comments: [{ id: "c1", body: "Nice", author: { id: "a", name: "Ann Lee", classYear: 2027 } }],
    });
    expect(gallery.galleryDownloadUrl).toHaveBeenCalledWith(viewer, "p1");
  });

  it("shows the report count to Core only", async () => {
    gallery.loadGalleryPost.mockResolvedValue(detail);
    expect(await runGetGalleryPost(ctx, { postId: "p1" })).not.toHaveProperty("reportCount");
    roles.getUserRoles.mockResolvedValue({ isCore: true });
    expect(await runGetGalleryPost(ctx, { postId: "p1" })).toMatchObject({ reportCount: 1 });
  });

  it("is not found when the post is gone or hidden from the caller", async () => {
    gallery.loadGalleryPost.mockResolvedValue(null);
    await expect(runGetGalleryPost(ctx, { postId: "p1" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("create_gallery_upload", () => {
  it("presigns the original under the originals prefix and copies under the gallery prefix", async () => {
    const out = await runCreateGalleryUpload(ctx, {
      original: { fileName: "IMG 0001.JPG", contentType: "image/jpeg" },
      display: { fileName: "display.webp", contentType: "image/webp" },
      thumb: { fileName: "thumb.jpg", contentType: "image/jpeg" },
    });
    expect(out.original.key).toMatch(/^uploads\/gallery-originals\/me\/[0-9a-f-]{36}-IMG_0001\.JPG$/);
    expect(out.display?.key).toMatch(/^uploads\/gallery\/me\/[0-9a-f-]{36}-display\.webp$/);
    expect(out.thumb?.key).toMatch(/^uploads\/gallery\/me\/[0-9a-f-]{36}-thumb\.jpg$/);
    expect(out.original.maxBytes).toBe(50 * 1024 * 1024);
    expect(out.display?.maxBytes).toBe(10 * 1024 * 1024);
    expect(out.original.curl).toContain("file=@/path/to/IMG_0001.JPG");
  });

  it("presigns only the original when no copies are named", async () => {
    const out = await runCreateGalleryUpload(ctx, {
      original: { fileName: "small.png", contentType: "image/png" },
    });
    expect(out).not.toHaveProperty("display");
    expect(out).not.toHaveProperty("thumb");
    expect(s3.getUploadPost).toHaveBeenCalledTimes(1);
  });

  it("refuses files that aren't photos", async () => {
    await expect(
      runCreateGalleryUpload(ctx, { original: { fileName: "deck.pdf", contentType: "application/pdf" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(s3.getUploadPost).not.toHaveBeenCalled();
  });

  it("says so when storage isn't configured", async () => {
    s3.isS3Configured.mockReturnValue(false);
    await expect(
      runCreateGalleryUpload(ctx, { original: { fileName: "a.jpg", contentType: "image/jpeg" } }),
    ).rejects.toThrow(/not configured/);
  });
});

describe("manage_gallery_post", () => {
  const imageKey = `uploads/gallery-originals/me/${UUID}-a.jpg`;

  it("creates posts through the web's intent with a grey placeholder by default, and returns their ids", async () => {
    gallery.applyGalleryIntent.mockResolvedValue({ ok: true, created: 1 });
    db.galleryPost.findMany.mockResolvedValue([{ id: "new1", imageKey }]);
    const out = await runManageGalleryPost(ctx, {
      action: "create",
      posts: [{ imageKey, width: 4000, height: 3000, caption: "Demo day" }],
    });
    const [request, who, fields] = gallery.applyGalleryIntent.mock.calls[0];
    expect(request).toBe(ctx.request);
    expect(who).toEqual(viewer);
    expect(fields.intent).toBe("create");
    expect(JSON.parse(fields.posts)).toEqual([
      { imageKey, width: 4000, height: 3000, caption: "Demo day", color: "#808080" },
    ]);
    expect(out).toEqual({ ok: true, posts: [{ id: "new1", link: "/community/gallery/new1" }] });
  });

  it("refuses to post an original whose upload never happened", async () => {
    s3.headObject.mockResolvedValue(null);
    await expect(
      runManageGalleryPost(ctx, { action: "create", posts: [{ imageKey, width: 1, height: 1 }] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(gallery.applyGalleryIntent).not.toHaveBeenCalled();
  });

  it("passes the web's own refusal through with its status", async () => {
    gallery.applyGalleryIntent.mockResolvedValue({ ok: false, status: 400, error: "Some photos could not be posted." });
    await expect(
      runManageGalleryPost(ctx, { action: "create", posts: [{ imageKey, width: 1, height: 1 }] }),
    ).rejects.toMatchObject({ status: 400, message: "Some photos could not be posted." });
  });

  it("requires each action's fields", async () => {
    await expect(runManageGalleryPost(ctx, { action: "react", postId: "p1" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(runManageGalleryPost(ctx, { action: "create" })).rejects.toMatchObject({ status: 400 });
  });

  it("toggles a reaction and comments on a visible post", async () => {
    await runManageGalleryPost(ctx, { action: "react", postId: "p1", emoji: "🎉" });
    await runManageGalleryPost(ctx, { action: "comment", postId: "p1", body: "Nice @ann" });
    expect(gallery.applyGalleryIntent.mock.calls.map((c) => c[2])).toMatchObject([
      { intent: "react", postId: "p1", emoji: "🎉" },
      { intent: "comment", postId: "p1", body: "Nice @ann" },
    ]);
    expect(db.galleryPost.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "p1" }, { visible: true }] },
      select: { authorId: true },
    });
  });

  it("is not found for a post the caller can't see", async () => {
    db.galleryPost.findFirst.mockResolvedValue(null);
    await expect(runManageGalleryPost(ctx, { action: "report", postId: "p1" })).rejects.toMatchObject({
      status: 404,
    });
    expect(gallery.applyGalleryIntent).not.toHaveBeenCalled();
  });

  it("deletes only the caller's own post", async () => {
    db.galleryPost.findFirst.mockResolvedValue({ authorId: "someone" });
    await expect(runManageGalleryPost(ctx, { action: "delete", postId: "p1" })).rejects.toMatchObject({
      status: 403,
    });
    db.galleryPost.findFirst.mockResolvedValue({ authorId: "me" });
    await expect(runManageGalleryPost(ctx, { action: "delete", postId: "p1" })).resolves.toEqual({ ok: true });
  });

  it("deletes a comment as its author or as Core, under the web's intent name", async () => {
    db.galleryComment.findFirst.mockResolvedValue({ authorId: "someone" });
    await expect(runManageGalleryPost(ctx, { action: "delete_comment", commentId: "c1" })).rejects.toMatchObject({
      status: 403,
    });
    roles.getUserRoles.mockResolvedValue({ isCore: true });
    await runManageGalleryPost(ctx, { action: "delete_comment", commentId: "c1" });
    expect(gallery.applyGalleryIntent.mock.calls[0][2]).toMatchObject({ intent: "delete-comment", commentId: "c1" });
  });

  it("is not found for a missing comment", async () => {
    db.galleryComment.findFirst.mockResolvedValue(null);
    await expect(runManageGalleryPost(ctx, { action: "delete_comment", commentId: "c1" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reports the web's Core-only refusal for hide", async () => {
    gallery.applyGalleryIntent.mockResolvedValue({ ok: false, status: 403 });
    await expect(runManageGalleryPost(ctx, { action: "hide", postId: "p1" })).rejects.toMatchObject({
      status: 403,
      message: "Forbidden",
    });
  });
});
