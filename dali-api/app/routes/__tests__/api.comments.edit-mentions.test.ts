import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_req: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/reactions.server", () => ({
  withEmojiImages: vi.fn(async (items: unknown[]) => items),
  addReaction: vi.fn().mockResolvedValue(null),
  commentReactionStore: vi.fn(() => ({ remove: vi.fn() })),
}));
vi.mock("~/lib/comment-events.server", () => ({ publishCommentChange: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/mentions.server", () => ({ notifyMentions: vi.fn().mockResolvedValue(undefined) }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { notifyMentions } from "~/lib/mentions.server";
import { action as itemAction } from "~/routes/api.comments.$id";

const db = prisma as any;
const item = (body: object) =>
  itemAction({
    request: new Request("http://localhost/api/comments/c1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    params: { id: "c1" },
  } as any) as Promise<Response>;

const chip = { type: "mention", userId: "u3", label: "ada" };
const prev = [{ type: "text", text: "hi " }, chip];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "pagedoc", targetId: "p1", parentId: null, bodyJson: prev });
  db.docComment.update.mockResolvedValue({});
});

describe("editing a comment keeps @mention chips", () => {
  it("stores the chips the editor sends and notifies only the newly mentioned", async () => {
    const next = [{ type: "text", text: "hi " }, chip, { type: "text", text: " and " }, { type: "mention", userId: "u4", label: "leo" }];
    expect((await item({ intent: "edit", body: "hi @ada and @leo", bodyJson: next })).status).toBe(200);
    await settle();
    expect(db.docComment.update.mock.calls[0][0].data).toEqual({ body: "hi @ada and @leo", bodyJson: next });
    expect(vi.mocked(notifyMentions).mock.calls).toHaveLength(1);
    expect(vi.mocked(notifyMentions).mock.calls[0][0].recipientUserIds).toEqual(["u4"]);
  });

  it("does not notify anyone again when the chips are unchanged", async () => {
    await item({ intent: "edit", body: "hello @ada", bodyJson: [{ type: "text", text: "hello " }, chip] });
    await settle();
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("keeps existing chips when the client sends no bodyJson", async () => {
    await item({ intent: "edit", body: "hello @ada" });
    await settle();
    expect(db.docComment.update.mock.calls[0][0].data.bodyJson).toEqual([{ type: "text", text: "hello " }, chip]);
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("rejects a malformed bodyJson without writing", async () => {
    expect((await item({ intent: "edit", body: "x", bodyJson: [{ type: "mention", label: "ada" }] })).status).toBe(400);
    expect(db.docComment.update).not.toHaveBeenCalled();
  });
});
