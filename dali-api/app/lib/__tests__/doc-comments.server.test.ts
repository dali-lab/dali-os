import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/mentions.server", () => ({
  extractHandlesFromText: vi.fn(() => []),
  resolveHandles: vi.fn().mockResolvedValue([]),
  notifyMentions: vi.fn().mockResolvedValue(undefined),
  pageDocLink: vi.fn(() => "/guide"),
}));
vi.mock("~/lib/comment-events.server", () => ({ publishCommentChange: vi.fn() }));
vi.mock("~/lib/comment-links.server", () => ({
  docCommentContext: vi.fn().mockResolvedValue({
    title: "Plan",
    link: "/documents/page1?comment=c9",
    replyLink: "/documents/page1",
    partnerReplyLink: null,
  }),
}));
vi.mock("~/projects/lib/file-notifications.server", () => ({
  notifyFileComment: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions.server";
import { publishCommentChange } from "~/lib/comment-events.server";
import { notifyFileComment } from "~/projects/lib/file-notifications.server";
import { CommentCreateError, createDocComment } from "../doc-comments.server";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  page: { findUnique: Fn };
  pageDoc: { findUnique: Fn };
  projectFile: { findUnique: Fn };
  projectFileVersion: { findFirst: Fn };
  docComment: { findUnique: Fn; findMany: Fn; create: Fn };
  critSubmission: { findUnique: Fn };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  db.page.findUnique.mockResolvedValue({ archivedAt: null, kind: "Doc" });
  db.projectFile.findUnique.mockResolvedValue({ archivedAt: null, currentVersionId: "v1" });
  db.docComment.create.mockResolvedValue({ id: "c9" });
  db.docComment.findMany.mockResolvedValue([]);
  vi.mocked(extractHandlesFromText).mockReturnValue([]);
  vi.mocked(resolveHandles).mockResolvedValue([]);
});

const doc = { targetType: "doc" as const, targetId: "page1", authorId: "u1", body: "hello" };

describe("createDocComment", () => {
  it("404s a missing or archived target", async () => {
    db.page.findUnique.mockResolvedValue({ archivedAt: new Date() });
    await expect(createDocComment(doc)).rejects.toMatchObject({ status: 404 });
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("rejects a reply to a reply or to another target", async () => {
    db.docComment.findUnique.mockResolvedValue({ targetType: "doc", targetId: "page1", parentId: "root" });
    await expect(createDocComment({ ...doc, parentId: "c1" })).rejects.toBeInstanceOf(CommentCreateError);
    db.docComment.findUnique.mockResolvedValue({ targetType: "doc", targetId: "other", parentId: null });
    await expect(createDocComment({ ...doc, parentId: "c1" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a slide anchor on a page that is not a slide deck", async () => {
    await expect(
      createDocComment({ ...doc, anchor: { kind: "slide", slideId: "s1" } as never }),
    ).rejects.toMatchObject({ status: 400, message: "Slide anchors only apply to slide decks" });
  });

  it("drops anchors on non-doc targets", async () => {
    await createDocComment({ ...doc, targetType: "file", targetId: "f1", anchor: { kind: "slide", slideId: "s1" } });
    expect(db.docComment.create.mock.calls[0]![0].data.anchor).toBeUndefined();
  });

  it("pins a file comment to the current version when none is given", async () => {
    await createDocComment({ ...doc, targetType: "file", targetId: "f1" });
    expect(db.docComment.create.mock.calls[0]![0].data).toMatchObject({ fileId: "f1", versionId: "v1" });
  });

  it("rejects a version that is not on the file", async () => {
    db.projectFileVersion.findFirst.mockResolvedValue(null);
    await expect(
      createDocComment({ ...doc, targetType: "file", targetId: "f1", versionId: "bad" }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid version" });
  });

  it("publishes a change event for doc comments only", async () => {
    await createDocComment(doc);
    expect(publishCommentChange).toHaveBeenCalledWith("page1");
  });

  it("notifies the file audience of a root file comment but not of a reply", async () => {
    await createDocComment({ ...doc, targetType: "file", targetId: "f1" });
    expect(notifyFileComment).toHaveBeenCalledWith({ fileId: "f1", authorId: "u1", body: "hello" });
    vi.mocked(notifyFileComment).mockClear();
    db.docComment.findUnique.mockResolvedValue({ targetType: "file", targetId: "f1", parentId: null });
    db.projectFile.findUnique.mockResolvedValue({ archivedAt: null, currentVersionId: "v1", title: "Spec" });
    await createDocComment({ ...doc, targetType: "file", targetId: "f1", parentId: "c1" });
    expect(notifyFileComment).not.toHaveBeenCalled();
  });

  it("notifies prior thread participants of a reply, excluding the author", async () => {
    db.docComment.findUnique.mockResolvedValue({ targetType: "doc", targetId: "page1", parentId: null });
    db.docComment.findMany.mockResolvedValue([{ authorId: "u2" }, { authorId: "u1" }, { authorId: "u2" }]);
    await createDocComment({ ...doc, parentId: "c1" });
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0]![0]).toMatchObject({
      eventType: "collab.comment_reply",
      recipients: [{ userId: "u2" }],
    });
  });

  it("does not notify when the author is the only thread participant", async () => {
    db.docComment.findUnique.mockResolvedValue({ targetType: "doc", targetId: "page1", parentId: null });
    db.docComment.findMany.mockResolvedValue([{ authorId: "u1" }]);
    await createDocComment({ ...doc, parentId: "c1" });
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it("resolves @handles in the plain body", async () => {
    vi.mocked(extractHandlesFromText).mockReturnValue(["ada"]);
    vi.mocked(resolveHandles).mockResolvedValue(["u2"]);
    await createDocComment({ ...doc, body: "hi @ada" });
    await settle();
    expect(notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["u2"], actorId: "u1", preview: "hi @ada" }),
    );
  });

  it("uses bodyJson mentions on doc targets without resolving handles", async () => {
    await createDocComment({
      ...doc,
      body: "hi @Ada",
      bodyJson: [{ type: "mention", userId: "u3", label: "Ada" }],
    });
    await settle();
    expect(resolveHandles).not.toHaveBeenCalled();
    expect(vi.mocked(notifyMentions).mock.calls[0]![0].recipientUserIds).toEqual(["u3"]);
  });

  it("dedupes a user named in both bodyJson and a handle on a file target", async () => {
    vi.mocked(resolveHandles).mockResolvedValue(["u3"]);
    await createDocComment({
      ...doc,
      targetType: "file",
      targetId: "f1",
      bodyJson: [{ type: "mention", userId: "u3", label: "Ada" }],
    });
    await settle();
    expect(vi.mocked(notifyMentions).mock.calls[0]![0].recipientUserIds).toEqual(["u3"]);
  });
});

describe("crit targets", () => {
  const crit = { targetType: "crit" as const, targetId: "s1", authorId: "u2", body: "Love the spacing" };
  const pin = { kind: "image" as const, x: 0.25, y: 0.75 };
  beforeEach(() => {
    db.critSubmission.findUnique.mockImplementation(async (q: any) => {
      if (q.select.kind) return { kind: "image" };
      if (q.select.title && q.select.authorId) return { authorId: "u1", title: "Logo" };
      if (q.select.title) return { title: "Logo" };
      return { domain: { resourceHubPage: { id: "hub1" } } };
    });
  });

  it("404s a post that is gone", async () => {
    db.critSubmission.findUnique.mockResolvedValue(null);
    await expect(createDocComment(crit)).rejects.toMatchObject({ status: 404 });
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("stores an image pin on a top-level comment on an image post", async () => {
    await createDocComment({ ...crit, anchor: pin });
    expect(db.docComment.create.mock.calls[0]![0].data).toMatchObject({ targetType: "crit", targetId: "s1", anchor: pin });
  });

  it("stores a whole-post comment with no anchor", async () => {
    await createDocComment(crit);
    expect(db.docComment.create.mock.calls[0]![0].data.anchor).toBeUndefined();
  });

  it("rejects an image pin on a file or link post", async () => {
    for (const kind of ["file", "link"]) {
      db.critSubmission.findUnique.mockResolvedValue({ kind });
      await expect(createDocComment({ ...crit, anchor: pin })).rejects.toMatchObject({ status: 400, message: "Pins only apply to images" });
    }
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("rejects a pinned reply and a non-image anchor", async () => {
    db.docComment.findUnique.mockResolvedValue({ targetType: "crit", targetId: "s1", parentId: null });
    await expect(createDocComment({ ...crit, parentId: "c1", anchor: pin })).rejects.toMatchObject({ status: 400 });
    await expect(createDocComment({ ...crit, anchor: { kind: "slide", slideId: "a" } as never })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an image pin on a document and drops it on a file", async () => {
    await expect(createDocComment({ ...doc, anchor: pin })).rejects.toMatchObject({ status: 400 });
    await createDocComment({ ...doc, targetType: "file", targetId: "f1", anchor: pin });
    expect(db.docComment.create.mock.calls[0]![0].data.anchor).toBeUndefined();
  });

  it("tells the person who shared the work about a top-level comment, not a reply", async () => {
    await createDocComment(crit);
    await settle();
    expect(vi.mocked(notify).mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ eventType: "crit.comment", recipients: [{ userId: "u1" }], message: expect.objectContaining({ link: "/resource-hub/hub1/crit?post=s1&thread=c9" }) }),
    ]);
    vi.mocked(notify).mockClear();
    db.docComment.findUnique.mockResolvedValue({ targetType: "crit", targetId: "s1", parentId: null });
    db.docComment.findMany.mockResolvedValue([{ authorId: "u1" }]);
    await createDocComment({ ...crit, parentId: "c1" });
    await settle();
    expect(vi.mocked(notify).mock.calls.map((c) => c[0].eventType)).toEqual(["collab.comment_reply"]);
  });

  it("does not notify when the author comments on their own post", async () => {
    await createDocComment({ ...crit, authorId: "u1" });
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it("links reply notifications to the thread on the crit page", async () => {
    db.docComment.findUnique.mockResolvedValue({ targetType: "crit", targetId: "s1", parentId: null });
    db.docComment.findMany.mockResolvedValue([{ authorId: "u1" }]);
    await createDocComment({ ...crit, parentId: "c1" });
    await settle();
    expect(vi.mocked(notify).mock.calls[0]![0]).toMatchObject({
      eventType: "collab.comment_reply",
      message: { link: "/resource-hub/hub1/crit?post=s1&thread=c1", vars: { itemTitle: "Logo" } },
    });
  });

  it("links mention notifications to the new thread, or to the thread being replied in", async () => {
    await createDocComment({ ...crit, bodyJson: [{ type: "mention", userId: "u3", label: "ada" }] });
    await settle();
    expect(vi.mocked(notifyMentions).mock.calls[0]![0]).toMatchObject({ recipientUserIds: ["u3"], link: "/resource-hub/hub1/crit?post=s1&thread=c9" });
    vi.mocked(notifyMentions).mockClear();
    db.docComment.findUnique.mockResolvedValue({ targetType: "crit", targetId: "s1", parentId: null });
    await createDocComment({ ...crit, parentId: "c1", bodyJson: [{ type: "mention", userId: "u3", label: "ada" }] });
    await settle();
    expect(vi.mocked(notifyMentions).mock.calls[0]![0].link).toBe("/resource-hub/hub1/crit?post=s1&thread=c1");
  });
});
