import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  mailComment: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const index = vi.hoisted(() => ({ getThreadLink: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/email/lib/mail-index.server", () => index);

import { loadThreadAnnotations } from "../thread-annotations.server";

describe("loadThreadAnnotations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.mailComment.findMany.mockResolvedValue([]);
    index.getThreadLink.mockResolvedValue(null);
  });

  it("reads the thread's comments oldest first with their authors", async () => {
    const rows = [{ id: "c1", body: "note", author: { id: "u1", firstName: "Ada", lastName: "L", photoUrl: null } }];
    db.mailComment.findMany.mockResolvedValue(rows);
    const r = await loadThreadAnnotations({ id: "a1", kind: "Shared" }, "t1");
    expect(r.comments).toBe(rows);
    expect(db.mailComment.findMany).toHaveBeenCalledWith({
      where: { accountId: "a1", threadId: "t1" },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
    });
  });

  it("returns the linked member on a Shared inbox", async () => {
    index.getThreadLink.mockResolvedValue({ userId: "u9", source: "Manual" });
    db.user.findUnique.mockResolvedValue({ firstName: "Grace", lastName: "H", photoUrl: "k" });
    const r = await loadThreadAnnotations({ id: "a1", kind: "Shared" }, "t1");
    expect(r.linkEnabled).toBe(true);
    expect(r.linkedUser).toEqual({ userId: "u9", firstName: "Grace", lastName: "H", photoUrl: "k", source: "Manual" });
  });

  it("does not look up links on other inbox kinds", async () => {
    const r = await loadThreadAnnotations({ id: "a1", kind: "Project" }, "t1");
    expect(r).toMatchObject({ linkEnabled: false, linkedUser: null });
    expect(index.getThreadLink).not.toHaveBeenCalled();
  });

  it("ignores partner-contact links and links to a deleted member", async () => {
    index.getThreadLink.mockResolvedValue({ partnerContactId: "p1", source: "Auto" });
    expect((await loadThreadAnnotations({ id: "a1", kind: "Shared" }, "t1")).linkedUser).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
    index.getThreadLink.mockResolvedValue({ userId: "gone", source: "Auto" });
    db.user.findUnique.mockResolvedValue(null);
    expect((await loadThreadAnnotations({ id: "a1", kind: "Shared" }, "t1")).linkedUser).toBeNull();
  });
});
