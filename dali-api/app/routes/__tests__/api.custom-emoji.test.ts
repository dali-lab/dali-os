import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  customEmoji: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(async () => []) },
}));
const requireAuth = vi.hoisted(() => vi.fn());
const getUserRoles = vi.hoisted(() => vi.fn());
const logAuditEvent = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/auth", () => ({ requireAuth }));
vi.mock("~/lib/roles", () => ({ getUserRoles }));
vi.mock("~/lib/audit", () => ({ logAuditEvent }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/lib/s3", () => ({ isS3Configured: () => false, getDownloadUrl: vi.fn() }));

import { action, loader } from "../api.custom-emoji";

const KEY = "uploads/custom-emoji/0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10-emoji.png";
const member = { isLabMember: true, isCore: false };

const post = (body: unknown) =>
  action({
    request: new Request("http://x/api/custom-emoji", { method: "POST", body: JSON.stringify(body) }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ ok: true, user: { sub: "ada" } });
  getUserRoles.mockResolvedValue(member);
  db.customEmoji.create.mockResolvedValue({ id: "e1" });
  db.customEmoji.updateMany.mockResolvedValue({ count: 1 });
});

describe("gates", () => {
  it("passes a failed sign-in through", async () => {
    requireAuth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = (await loader({ request: new Request("http://x") } as never)) as Response;
    expect(res.status).toBe(401);
  });

  it("refuses someone outside the lab, reading or writing", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: false, isCore: false });
    const read = (await loader({ request: new Request("http://x") } as never)) as Response;
    expect(read.status).toBe(403);
    expect(((await post({ intent: "add", name: "ok", imageKey: KEY })) as Response).status).toBe(403);
    expect(db.customEmoji.create).not.toHaveBeenCalled();
  });
});

describe("add", () => {
  it("saves the emoji against the adder and audits it", async () => {
    const res = (await post({ intent: "add", name: "party-parrot", imageKey: KEY })) as Response;
    expect(res.status).toBe(200);
    expect(db.customEmoji.create.mock.calls[0][0].data).toEqual({
      name: "party-parrot",
      imageKey: KEY,
      addedById: "ada",
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "custom_emoji.add", targetId: "e1", metadata: { name: "party-parrot" } }),
    );
  });

  it("refuses a bad name", async () => {
    for (const name of ["a", "Has Space", "UPPER", "x".repeat(49), 7]) {
      const res = (await post({ intent: "add", name, imageKey: KEY })) as Response;
      expect(res.status).toBe(400);
    }
    expect(db.customEmoji.create).not.toHaveBeenCalled();
  });

  it("refuses a key the picker wouldn't produce", async () => {
    const keys = [
      "uploads/feedback/0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10-emoji.png",
      "uploads/custom-emoji/0b8f4a52-6a51-4c3e-9d5b-2f1a7c9e8d10-emoji.svg",
      "uploads/custom-emoji/../resumes/x-emoji.png",
    ];
    for (const imageKey of keys) {
      expect(((await post({ intent: "add", name: "ok", imageKey })) as Response).status).toBe(400);
    }
  });

  it("reports a taken name, which includes deleted emoji", async () => {
    db.customEmoji.create.mockRejectedValue({ code: "P2002" });
    const res = (await post({ intent: "add", name: "parrot", imageKey: KEY })) as Response;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That name is taken." });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("doesn't swallow other database errors", async () => {
    db.customEmoji.create.mockRejectedValue(new Error("down"));
    await expect(post({ intent: "add", name: "parrot", imageKey: KEY })).rejects.toThrow("down");
  });
});

describe("delete", () => {
  it("keeps the row and scopes a member to their own", async () => {
    await post({ intent: "delete", id: "e1" });
    const args = db.customEmoji.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "e1", deletedAt: null, addedById: "ada" });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "custom_emoji.delete", targetId: "e1" }),
    );
  });

  it("lets Core delete anyone's", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: true, isCore: true });
    await post({ intent: "delete", id: "e1" });
    expect(db.customEmoji.updateMany.mock.calls[0][0].where).toEqual({ id: "e1", deletedAt: null });
  });

  it("404s on someone else's emoji without auditing", async () => {
    db.customEmoji.updateMany.mockResolvedValue({ count: 0 });
    expect(((await post({ intent: "delete", id: "e1" })) as Response).status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

it("refuses an unknown intent", async () => {
  expect(((await post({ intent: "nope" })) as Response).status).toBe(400);
});
