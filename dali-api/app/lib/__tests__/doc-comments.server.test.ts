import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/mentions", () => ({
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
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions";
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
    await createDocComment({ ...doc, targetType: "file", targetId: "f1", anchor: { from: "a", to: "b" } });
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
