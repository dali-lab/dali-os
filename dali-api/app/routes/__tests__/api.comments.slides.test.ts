import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_req: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/collabAuth", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/comment-events.server", () => ({ publishCommentChange: vi.fn() }));
vi.mock("~/lib/mentions", () => ({
  extractHandlesFromText: vi.fn(() => []),
  resolveHandles: vi.fn().mockResolvedValue([]),
  notifyMentions: vi.fn(),
  pageDocLink: vi.fn(() => "/"),
}));
vi.mock("~/projects/lib/file-notifications.server", () => ({ notifyFileComment: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { notifyMentions } from "~/lib/mentions";
import { getPageAccess } from "~/lib/pageAccess.server";
import { action } from "~/routes/api.comments";

const db = prisma as any;
const flush = () => new Promise((r) => setTimeout(r, 0));

function post(body: unknown) {
  const request = new Request("http://localhost/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: {} } as any) as Promise<Response>;
}

const slideComment = (overrides: Record<string, unknown> = {}) => ({
  targetType: "doc",
  targetId: "deck-1",
  body: "Cut this slide",
  anchor: { kind: "slide", slideId: "s1" },
  ...overrides,
});

function pageIs(kind: string) {
  db.page.findUnique.mockImplementation(async ({ select }: any) => ({
    archivedAt: null,
    kind,
    title: "Quarterly update",
    ...(select ? {} : {}),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada", type: "member" } } as any);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: true });
  db.docComment.create.mockResolvedValue({ id: "c-new" });
  pageIs("Slides");
});

describe("slide anchors on create", () => {
  it.each([
    ["slide", { kind: "slide", slideId: "s1" }],
    ["element", { kind: "slide", slideId: "s1", elementId: "title" }],
    ["pin", { kind: "slide", slideId: "s1", x: 0.4, y: 0.7 }],
    ["text range", { kind: "blocknote", slideId: "s1", elementId: "body" }],
  ])("stores a %s anchor", async (_name, anchor) => {
    const res = await post(slideComment({ anchor }));
    expect(res.status).toBe(201);
    expect(db.docComment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ anchor }) }));
  });

  it.each([
    ["a missing slide id", { kind: "slide" }],
    ["half a point", { kind: "slide", slideId: "s1", x: 0.5 }],
    ["a point off the slide", { kind: "slide", slideId: "s1", x: 2, y: 0.5 }],
    ["unknown fields", { kind: "slide", slideId: "s1", script: "x" }],
    ["an element with no slide", { kind: "blocknote", elementId: "body" }],
  ])("rejects %s with 400 and writes nothing", async (_name, anchor) => {
    const res = await post(slideComment({ anchor }));
    expect(res.status).toBe(400);
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("rejects a slide anchor on a page that is not a deck", async () => {
    pageIs("Doc");
    const res = await post(slideComment());
    expect(res.status).toBe(400);
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("still takes inline blocknote anchors on any page", async () => {
    pageIs("Doc");
    const res = await post(slideComment({ anchor: { kind: "blocknote" } }));
    expect(res.status).toBe(201);
  });

  it("rejects a legacy {from, to} anchor", async () => {
    pageIs("Doc");
    const res = await post(slideComment({ anchor: { from: "a", to: "b" } }));
    expect(res.status).toBe(400);
    expect(db.docComment.create).not.toHaveBeenCalled();
  });
});

describe("access", () => {
  it("lets a commenter without edit rights pin a comment", async () => {
    const res = await post(slideComment());
    expect(res.status).toBe(201);
  });

  it("refuses someone who cannot see the deck", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false, canEdit: false, canComment: false });
    const res = await post(slideComment());
    expect(res.status).toBe(403);
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("refuses a view-only share", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: false });
    expect((await post(slideComment())).status).toBe(403);
  });
});

describe("notifications", () => {
  it("links a reply to the slide and thread, through notify()", async () => {
    db.docComment.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "root-1"
        ? { targetType: "doc", targetId: "deck-1", parentId: null, anchor: { kind: "slide", slideId: "s1" } }
        : null,
    );
    db.docComment.findMany.mockResolvedValue([{ authorId: "grace" }]);
    const res = await post(slideComment({ parentId: "root-1", anchor: null }));
    expect(res.status).toBe(201);
    await flush();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "collab.comment_reply",
        recipients: [{ userId: "grace" }],
        message: expect.objectContaining({ link: "/slides/deck-1?slide=s1&thread=root-1" }),
      }),
    );
  });

  it("links a mention in a new pinned thread to its own thread", async () => {
    const res = await post(slideComment({ bodyJson: [{ type: "mention", userId: "grace", label: "grace" }] }));
    expect(res.status).toBe(201);
    await flush();
    expect(notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["grace"], link: "/slides/deck-1?slide=s1&thread=c-new" }),
    );
  });
});
