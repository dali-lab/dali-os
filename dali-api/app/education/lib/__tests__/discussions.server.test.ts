import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("../notifications.server", () => ({
  educationLink: vi.fn((u: { id: string }, offeringId: string) => `/edu/${u.id}/${offeringId}`),
}));
vi.mock("../announcements.server", () => ({
  postAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import { postAnnouncement, deleteAnnouncement } from "../announcements.server";
import {
  listThreads,
  listThreadPage,
  offeringInstructorIds,
  createPost,
  deletePost,
  runDiscussionAction,
} from "../discussions.server";

type M = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as M;

beforeEach(() => {
  vi.resetAllMocks();
});

const author = (id: string, firstName = "Ada", lastName = "Lovelace") => ({ id, firstName, lastName });
const post = (id: string, parentId: string | null, at: number, a = author("u1")) => ({
  id,
  body: `body-${id}`,
  parentId,
  createdAt: new Date(at),
  author: a,
});

describe("listThreads", () => {
  it("returns newest threads first with replies oldest-first, flagging instructors", async () => {
    db.educationDiscussionPost.findMany.mockResolvedValue([
      post("r1", null, 1),
      post("r2", null, 2, author("ins", "Grace", "Hopper")),
      post("c1", "r1", 3),
      post("c2", "r1", 4, author("ins", "Grace", "Hopper")),
    ]);
    const out = await listThreads("off-1", new Set(["ins"]));
    expect(db.educationDiscussionPost.findMany.mock.calls[0][0].where).toEqual({ offeringId: "off-1" });
    expect(out.map((t) => t.id)).toEqual(["r2", "r1"]);
    expect(out[0]).toMatchObject({ authorName: "Grace Hopper", isInstructor: true, replies: [] });
    expect(out[1].replies.map((r) => [r.id, r.isInstructor])).toEqual([["c1", false], ["c2", true]]);
  });

  it("trims the author name when the last name is blank", async () => {
    db.educationDiscussionPost.findMany.mockResolvedValue([post("r1", null, 1, author("u", "Ada", ""))]);
    expect((await listThreads("off-1", new Set()))[0].authorName).toBe("Ada");
  });
});

describe("listThreadPage", () => {
  it("restricts roots to the offering's top-level posts, ANDs a keyset predicate and bounds with take", async () => {
    db.educationDiscussionPost.findMany.mockResolvedValue([]);
    const and = { createdAt: { lt: new Date(5) } };
    await listThreadPage("off-1", new Set(), { and, take: 10 });
    const arg = db.educationDiscussionPost.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ AND: [{ offeringId: "off-1", parentId: null }, and] });
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(db.educationDiscussionPost.findMany).toHaveBeenCalledTimes(1);
  });

  it("fetches replies only for the returned roots and attaches them oldest-first", async () => {
    db.educationDiscussionPost.findMany
      .mockResolvedValueOnce([post("r2", null, 9), post("r1", null, 1)])
      .mockResolvedValueOnce([post("c1", "r1", 2), post("c2", "r1", 3)]);
    const out = await listThreadPage("off-1", new Set());
    const repliesArg = db.educationDiscussionPost.findMany.mock.calls[1][0];
    expect(repliesArg.where).toEqual({ offeringId: "off-1", parentId: { in: ["r2", "r1"] } });
    expect(out.map((t) => [t.id, t.replies.map((r) => r.id)])).toEqual([["r2", []], ["r1", ["c1", "c2"]]]);
  });
});

describe("offeringInstructorIds", () => {
  it("returns the set of assigned instructor ids", async () => {
    db.instructorAssignment.findMany.mockResolvedValue([{ userId: "a" }, { userId: "b" }]);
    expect(await offeringInstructorIds("off-1")).toEqual(new Set(["a", "b"]));
    expect(db.instructorAssignment.findMany.mock.calls[0][0].where).toEqual({ offeringId: "off-1" });
  });
});

describe("createPost", () => {
  const base = { offeringId: "off-1", authorId: "st-1", body: "  Hello  " };

  beforeEach(() => {
    db.educationDiscussionPost.create.mockResolvedValue({ id: "p1" });
    db.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Intro" });
    db.instructorAssignment.findMany.mockResolvedValue([{ userId: "ins-1" }, { userId: "ins-2" }]);
    db.user.findMany.mockImplementation(async ({ where }) =>
      where.id.in.map((id: string) => ({ id, daliEmail: `${id}@example.edu` })),
    );
    vi.mocked(notify).mockResolvedValue(undefined as never);
  });

  it("rejects an empty post", async () => {
    expect(await createPost({ ...base, body: "  " })).toEqual({ error: "Your post can't be empty.", status: 400 });
    expect(db.educationDiscussionPost.create).not.toHaveBeenCalled();
  });

  it("404s when the parent is missing or in another offering", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValueOnce(null);
    expect(await createPost({ ...base, parentId: "x" })).toEqual({ error: "Post not found", status: 404 });
    db.educationDiscussionPost.findUnique.mockResolvedValueOnce({ offeringId: "off-2", parentId: null });
    expect(await createPost({ ...base, parentId: "x" })).toMatchObject({ status: 404 });
    expect(db.educationDiscussionPost.create).not.toHaveBeenCalled();
  });

  it("rejects replying to a reply", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValue({ offeringId: "off-1", parentId: "root" });
    expect(await createPost({ ...base, parentId: "c" })).toEqual({
      error: "Replies can't be nested further",
      status: 400,
    });
  });

  it("stores the trimmed body as a top-level post and audits it", async () => {
    expect(await createPost(base)).toEqual({ ok: true, id: "p1" });
    expect(db.educationDiscussionPost.create.mock.calls[0][0].data).toEqual({
      offeringId: "off-1",
      authorId: "st-1",
      body: "Hello",
      parentId: null,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "education.discussion.post",
        userId: "st-1",
        targetId: "p1",
        metadata: { offeringId: "off-1", reply: false },
      }),
    );
  });

  it("a student's top-level post notifies every instructor with a hub link", async () => {
    await createPost(base);
    const arg = vi.mocked(notify).mock.calls[0][0] as any;
    expect(arg.eventType).toBe("education.discussion");
    expect(arg.createdByUserId).toBe("st-1");
    expect(arg.message).toEqual({
      copyKey: "education.discussion.post",
      vars: { contextName: "Intro", itemDetail: "Hello" },
    });
    expect(arg.recipients).toEqual([
      { userId: "ins-1", link: "/edu/ins-1/off-1/hub?tab=discussions" },
      { userId: "ins-2", link: "/edu/ins-2/off-1/hub?tab=discussions" },
    ]);
  });

  it("an instructor's top-level post notifies Approved enrollees, not themself", async () => {
    db.educationApplication.findMany.mockResolvedValue([
      { applicantUserId: "st-1" },
      { applicantUserId: "st-2" },
    ]);
    await createPost({ ...base, authorId: "ins-1" });
    expect(db.educationApplication.findMany.mock.calls[0][0].where).toEqual({
      offeringId: "off-1",
      status: "Approved",
    });
    const ids = (vi.mocked(notify).mock.calls[0][0] as any).recipients.map((r: any) => r.userId);
    expect(ids).toEqual(["st-1", "st-2"]);
  });

  it("an instructor posting alone with no other instructors does not notify instructors", async () => {
    db.instructorAssignment.findMany.mockResolvedValue([{ userId: "ins-1" }]);
    db.educationApplication.findMany.mockResolvedValue([{ applicantUserId: "ins-1" }]);
    await createPost({ ...base, authorId: "ins-1" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("a reply notifies only the parent's author with the reply copy", async () => {
    db.educationDiscussionPost.findUnique
      .mockResolvedValueOnce({ offeringId: "off-1", parentId: null })
      .mockResolvedValueOnce({ authorId: "st-9" });
    await createPost({ ...base, parentId: "root" });
    expect(db.educationDiscussionPost.create.mock.calls[0][0].data.parentId).toBe("root");
    const arg = vi.mocked(notify).mock.calls[0][0] as any;
    expect(arg.message.copyKey).toBe("education.discussion.reply");
    expect(arg.recipients.map((r: any) => r.userId)).toEqual(["st-9"]);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { offeringId: "off-1", reply: true } }),
    );
  });

  it("replying to your own post notifies nobody", async () => {
    db.educationDiscussionPost.findUnique
      .mockResolvedValueOnce({ offeringId: "off-1", parentId: null })
      .mockResolvedValueOnce({ authorId: "st-1" });
    await createPost({ ...base, parentId: "root" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("truncates long previews to 140 characters plus an ellipsis", async () => {
    await createPost({ ...base, body: "x".repeat(200) });
    const preview = (vi.mocked(notify).mock.calls[0][0] as any).message.vars.itemDetail;
    expect(preview).toBe(`${"x".repeat(140)}…`);
  });

  it("keeps the post when notification fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(notify).mockRejectedValue(new Error("down"));
    expect(await createPost(base)).toEqual({ ok: true, id: "p1" });
    expect(logAuditEvent).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("skips notifications when the offering is gone", async () => {
    db.educationOffering.findUnique.mockResolvedValue(null);
    expect(await createPost(base)).toEqual({ ok: true, id: "p1" });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("deletePost", () => {
  const args = { postId: "p1", offeringId: "off-1", actorId: "u1", isManager: false };

  it("404s for a missing post or one in another offering", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValueOnce(null);
    expect(await deletePost(args)).toEqual({ error: "Post not found", status: 404 });
    db.educationDiscussionPost.findUnique.mockResolvedValueOnce({ offeringId: "off-2", authorId: "u1" });
    expect(await deletePost(args)).toMatchObject({ status: 404 });
    expect(db.educationDiscussionPost.delete).not.toHaveBeenCalled();
  });

  it("forbids deleting someone else's post unless a manager", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "other" });
    expect(await deletePost(args)).toEqual({ error: "Forbidden", status: 403 });
    expect(db.educationDiscussionPost.delete).not.toHaveBeenCalled();
  });

  it("lets the author delete their own post and audits it", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "u1" });
    expect(await deletePost(args)).toEqual({ ok: true });
    expect(db.educationDiscussionPost.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "education.discussion.delete", userId: "u1", targetId: "p1" }),
    );
  });

  it("lets a manager delete anyone's post", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "other" });
    expect(await deletePost({ ...args, isManager: true })).toEqual({ ok: true });
  });
});

describe("runDiscussionAction", () => {
  const ctx = { offeringId: "off-1", userId: "u1", isManager: true };
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("rejects unknown intents with 400", async () => {
    const res = (await runDiscussionAction(form({ intent: "nope" }), ctx)) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown intent" });
  });

  it("post-announcement: only the literal Announcement kind is honoured, blank parent becomes null", async () => {
    vi.mocked(postAnnouncement).mockResolvedValue({ ok: true } as never);
    await runDiscussionAction(form({ intent: "post-announcement", body: "hi", kind: "Announcement" }), ctx);
    expect(postAnnouncement).toHaveBeenLastCalledWith({
      offeringId: "off-1", authorId: "u1", body: "hi", kind: "Announcement", parentId: null,
    });
    await runDiscussionAction(form({ intent: "post-announcement", body: "hi", kind: "Other", parentId: "p" }), ctx);
    expect(postAnnouncement).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "Message", parentId: "p" }));
  });

  it("surfaces service errors as JSON responses with their status", async () => {
    vi.mocked(postAnnouncement).mockResolvedValue({ error: "Forbidden", status: 403 } as never);
    const res = (await runDiscussionAction(form({ intent: "post-announcement" }), ctx)) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("delete-announcement passes the manager flag through", async () => {
    vi.mocked(deleteAnnouncement).mockResolvedValue({ ok: true } as never);
    expect(await runDiscussionAction(form({ intent: "delete-announcement", postId: "p9" }), ctx)).toEqual({ ok: true });
    expect(deleteAnnouncement).toHaveBeenCalledWith({ postId: "p9", offeringId: "off-1", actorId: "u1", isManager: true });
  });

  it("post-discussion creates a post and returns the error response when empty", async () => {
    const res = (await runDiscussionAction(form({ intent: "post-discussion", body: "  " }), ctx)) as Response;
    expect(res.status).toBe(400);
    expect(db.educationDiscussionPost.create).not.toHaveBeenCalled();
  });

  it("delete-discussion enforces ownership for non-managers", async () => {
    db.educationDiscussionPost.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "other" });
    const res = (await runDiscussionAction(
      form({ intent: "delete-discussion", postId: "p1" }),
      { ...ctx, isManager: false },
    )) as Response;
    expect(res.status).toBe(403);
    expect(db.educationDiscussionPost.delete).not.toHaveBeenCalled();
  });
});
