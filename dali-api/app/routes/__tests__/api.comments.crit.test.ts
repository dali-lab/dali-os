import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_req: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/collabAuth.server", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([{ id: "u1", name: "Ada Lovelace", photoUrl: null }]) }));
vi.mock("~/lib/reactions.server", () => ({
  withEmojiImages: vi.fn(async (items: unknown[]) => items),
  addReaction: vi.fn().mockResolvedValue(null),
  commentReactionStore: vi.fn(() => ({ remove: vi.fn() })),
}));
vi.mock("~/lib/comment-events.server", () => ({ publishCommentChange: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/mentions.server", () => ({ notifyMentions: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/doc-comments.server", async () => {
  class CommentCreateError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  }
  return { CommentCreateError, createDocComment: vi.fn().mockResolvedValue({ id: "c1" }) };
});
vi.mock("~/lib/crit-comments.server", () => ({ loadCritTarget: vi.fn(), critHiddenAuthorId: vi.fn().mockResolvedValue(null), critActorIsAnonymous: vi.fn().mockResolvedValue(false), critThreadLink: vi.fn(async (s: string, t: string) => `/resource-hub/hub1/crit?post=${s}&thread=${t}`) }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { notifyMentions } from "~/lib/mentions.server";
import { addReaction } from "~/lib/reactions.server";
import { createDocComment } from "~/lib/doc-comments.server";
import { critActorIsAnonymous, loadCritTarget } from "~/lib/crit-comments.server";
import { action, loader } from "~/routes/api.comments";
import { action as itemAction } from "~/routes/api.comments.$id";

const db = prisma as any;
const target = (canModerate = false) => ({ id: "s1", pageId: "hub1", kind: "image", title: "Logo", authorId: "poster", canModerate });
const as = (sub: string) => vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub, type: "member" } } as any);

const create = (body: object) =>
  action({ request: new Request("http://localhost/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), params: {} } as any) as Promise<Response>;
const list = () =>
  loader({ request: new Request("http://localhost/api/comments?targetType=crit&targetId=s1"), params: {} } as any) as Promise<Response>;
const item = (method: "POST" | "DELETE", body?: object) =>
  itemAction({
    request: new Request("http://localhost/api/comments/c1", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    params: { id: "c1" },
  } as any) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  as("u1");
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(loadCritTarget).mockResolvedValue(target() as any);
  db.docComment.findMany.mockResolvedValue([]);
  db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "crit", targetId: "s1", parentId: null });
  db.docComment.delete.mockResolvedValue({});
});

describe("reading and posting crit comments", () => {
  it("lists a post's threads for someone who can see its wall", async () => {
    expect((await list()).status).toBe(200);
    expect(db.docComment.findMany.mock.calls[0][0].where).toEqual({ targetType: "crit", targetId: "s1" });
  });

  it("refuses to list or post when the wall is not visible to the caller", async () => {
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    expect((await list()).status).toBe(403);
    expect((await create({ targetType: "crit", targetId: "s1", body: "hi" })).status).toBe(403);
    expect(createDocComment).not.toHaveBeenCalled();
  });

  it("posts a pinned comment with the image anchor", async () => {
    const res = await create({ targetType: "crit", targetId: "s1", body: "hi", anchor: { kind: "image", x: 0.2, y: 0.8 } });
    expect(res.status).toBe(201);
    expect(createDocComment).toHaveBeenCalledWith(expect.objectContaining({ targetType: "crit", targetId: "s1", anchor: { kind: "image", x: 0.2, y: 0.8 } }));
  });

  it("rejects a pin outside the image", async () => {
    expect((await create({ targetType: "crit", targetId: "s1", body: "hi", anchor: { kind: "image", x: 1.5, y: 0.8 } })).status).toBe(400);
    expect(createDocComment).not.toHaveBeenCalled();
  });

  it("passes a rejected pin on a file post back as a 400", async () => {
    const { CommentCreateError } = await import("~/lib/doc-comments.server");
    vi.mocked(createDocComment).mockRejectedValueOnce(new CommentCreateError("Pins only apply to images", 400));
    const res = await create({ targetType: "crit", targetId: "s1", body: "hi", anchor: { kind: "image", x: 0.2, y: 0.8 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pins only apply to images" });
  });
});

describe("deleting crit comments", () => {
  it("lets an author delete their own comment", async () => {
    expect((await item("DELETE")).status).toBe(200);
    expect(db.docComment.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("does not let another member delete it", async () => {
    as("u2");
    expect((await item("DELETE")).status).toBe(403);
    expect(db.docComment.delete).not.toHaveBeenCalled();
  });

  it("does not let the person who shared the work delete someone else's comment", async () => {
    as("poster");
    expect((await item("DELETE")).status).toBe(403);
    expect(db.docComment.delete).not.toHaveBeenCalled();
  });

  it("lets Core or a domain lead delete anyone's", async () => {
    as("lead");
    vi.mocked(loadCritTarget).mockResolvedValue(target(true) as any);
    expect((await item("DELETE")).status).toBe(200);
    expect(db.docComment.delete).toHaveBeenCalledTimes(1);
  });

  it("lets an author delete their own comment even after losing access to the wall", async () => {
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    expect((await item("DELETE")).status).toBe(200);
  });
});

describe("editing and reacting on crit comments", () => {
  it("only lets the author edit, and links new mentions to the thread", async () => {
    db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "crit", targetId: "s1", parentId: null, bodyJson: [] });
    const res = await item("POST", { intent: "edit", body: "hi @ada", bodyJson: [{ type: "text", text: "hi " }, { type: "mention", userId: "u3", label: "ada" }] });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(notifyMentions).mock.calls[0][0]).toMatchObject({ recipientUserIds: ["u3"], link: "/resource-hub/hub1/crit?post=s1&thread=c1" });
    as("u2");
    expect((await item("POST", { intent: "edit", body: "mine now" })).status).toBe(403);
  });

  it("lets someone who can see the wall react, and no one else", async () => {
    expect((await item("POST", { intent: "react", emoji: "👍" })).status).toBe(200);
    expect(addReaction).toHaveBeenCalledTimes(1);
    vi.mocked(addReaction).mockClear();
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    expect((await item("POST", { intent: "react", emoji: "👍" })).status).toBe(403);
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("does not accept set-anchor on a crit comment, or an image anchor on a document comment", async () => {
    expect((await item("POST", { intent: "set-anchor", anchor: { kind: "image", x: 0.1, y: 0.1 } })).status).toBe(400);
    db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "doc", targetId: "page1", parentId: null });
    expect((await item("POST", { intent: "set-anchor", anchor: { kind: "image", x: 0.1, y: 0.1 } })).status).toBe(400);
    expect(db.docComment.update).not.toHaveBeenCalled();
  });
});

describe("editing keeps @mention chips", () => {
  const chip = { type: "mention", userId: "u3", label: "ada" };
  const prev = [{ type: "text", text: "hi " }, chip];
  const settle = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(() => {
    db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "crit", targetId: "s1", parentId: null, bodyJson: prev });
    db.docComment.update.mockResolvedValue({});
  });

  it("stores the chips the editor sends and notifies only the newly mentioned", async () => {
    const next = [{ type: "text", text: "hi " }, chip, { type: "text", text: " and " }, { type: "mention", userId: "u4", label: "leo" }];
    expect((await item("POST", { intent: "edit", body: "hi @ada and @leo", bodyJson: next })).status).toBe(200);
    await settle();
    expect(db.docComment.update.mock.calls[0][0].data).toEqual({ body: "hi @ada and @leo", bodyJson: next });
    expect(vi.mocked(notifyMentions).mock.calls).toHaveLength(1);
    expect(vi.mocked(notifyMentions).mock.calls[0][0].recipientUserIds).toEqual(["u4"]);
  });

  it("does not notify anyone again when the chips are unchanged", async () => {
    await item("POST", { intent: "edit", body: "hello @ada", bodyJson: [{ type: "text", text: "hello " }, chip] });
    await settle();
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("keeps existing chips when the client sends no bodyJson", async () => {
    await item("POST", { intent: "edit", body: "hello @ada" });
    await settle();
    expect(db.docComment.update.mock.calls[0][0].data.bodyJson).toEqual([{ type: "text", text: "hello " }, chip]);
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("rejects a malformed bodyJson without writing", async () => {
    expect((await item("POST", { intent: "edit", body: "x", bodyJson: [{ type: "mention", label: "ada" }] })).status).toBe(400);
    expect(db.docComment.update).not.toHaveBeenCalled();
  });

  it("does not name an anonymous poster as the actor of a new mention", async () => {
    vi.mocked(critActorIsAnonymous).mockResolvedValue(true);
    await item("POST", { intent: "edit", body: "hi @leo", bodyJson: [{ type: "mention", userId: "u4", label: "leo" }] });
    await settle();
    expect(vi.mocked(notifyMentions).mock.calls[0][0]).toMatchObject({ actorId: "u1", anonymousActor: true });
  });
});
