import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  sentTo: string;
  batch: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  user: { firstName: string };
};
let rows: Row[] = [];
let nextId = 1;

vi.mock("~/lib/db.server", () => ({
  prisma: {
    alumniInvite: {
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        const row = { id: `i${nextId++}`, usedAt: null, createdAt: new Date(), user: { firstName: "Ada" }, ...data } as Row;
        rows.push(row);
        return { id: row.id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { userId: string; createdAt: { gt: Date } } }) =>
        rows.find((r) => r.userId === where.userId && r.createdAt > where.createdAt.gt) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { tokenHash: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } }) => {
        const hit = rows.filter((r) => r.tokenHash === where.tokenHash && r.usedAt === null && r.expiresAt > where.expiresAt.gt);
        hit.forEach((r) => (r.usedAt = data.usedAt));
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows = rows.filter((r) => r.id !== where.id);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "ob1", deduped: false })),
  drainNow: vi.fn(),
}));
vi.mock("~/email/lib/templates.server", () => ({ renderEmailTemplate: vi.fn() }));

import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { renderEmailTemplate } from "~/email/lib/templates.server";
import {
  createAlumniInvite,
  hashInviteToken,
  lookupAlumniInvite,
  redeemAlumniInvite,
  sendFreshAlumniInvite,
  sendLaunchInvite,
  FRESH_LINK_COOLDOWN_MS,
} from "~/lib/alumni-invite.server";

beforeEach(() => {
  rows = [];
  nextId = 1;
  vi.clearAllMocks();
});

const ago = (ms: number) => new Date(Date.now() - ms);

describe("createAlumniInvite", () => {
  it("stores only the sha256 of the token, never the token", async () => {
    const invite = await createAlumniInvite({ userId: "u1", sentTo: " Ada@Example.EDU ", batch: "b1" });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows[0].tokenHash).toBe(hashInviteToken(invite.token));
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(invite.token);
    expect(rows[0].sentTo).toBe("ada@example.edu");
    expect(invite.url).toBe(`http://localhost:3001/alumni/invite/${invite.token}`);
  });

  it("expires in 60 days by default", async () => {
    const invite = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    const days = (invite.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.99);
    expect(days).toBeLessThanOrEqual(60);
  });
});

describe("lookupAlumniInvite", () => {
  it("reports valid, expired, used and unknown without consuming anything", async () => {
    const valid = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    const expired = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co", ttlMs: -1000 });
    const used = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    rows[2].usedAt = new Date();

    expect(await lookupAlumniInvite(valid.token)).toEqual({ status: "valid", userId: "u1", firstName: "Ada" });
    expect(await lookupAlumniInvite(valid.token)).toMatchObject({ status: "valid" });
    expect((await lookupAlumniInvite(expired.token)).status).toBe("expired");
    expect((await lookupAlumniInvite(used.token)).status).toBe("used");
    expect(await lookupAlumniInvite("nope")).toEqual({ status: "unknown" });
    expect(rows[0].usedAt).toBeNull();
  });
});

describe("redeemAlumniInvite", () => {
  it("redeems once and returns the user and address", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    expect(await redeemAlumniInvite(token)).toEqual({ ok: true, userId: "u1", sentTo: "a@b.co" });
    expect(await redeemAlumniInvite(token)).toEqual({ ok: false });
  });

  it("refuses an expired or unknown token", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co", ttlMs: -1 });
    expect(await redeemAlumniInvite(token)).toEqual({ ok: false });
    expect(await redeemAlumniInvite("nope")).toEqual({ ok: false });
  });

  it("lets only one of two simultaneous redeems win", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    const results = await Promise.all([redeemAlumniInvite(token), redeemAlumniInvite(token)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("treats a claim count other than 1 as a loss", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    const { prisma } = await import("~/lib/db.server");
    vi.mocked(prisma.alumniInvite.updateMany).mockResolvedValueOnce({ count: 0 });
    expect(await redeemAlumniInvite(token)).toEqual({ ok: false });
  });
});

describe("sendFreshAlumniInvite", () => {
  it("does nothing for an unknown token or a link that still works", async () => {
    await sendFreshAlumniInvite("nope");
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    await sendFreshAlumniInvite(token);
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("mails a new link to the same address when the old one is used or expired", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co", batch: "b1" });
    rows[0].usedAt = new Date();
    rows[0].createdAt = ago(FRESH_LINK_COOLDOWN_MS + 1000);

    await sendFreshAlumniInvite(token);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ userId: "u1", sentTo: "a@b.co", batch: "b1", usedAt: null });
    const sent = vi.mocked(enqueueOutbound).mock.calls[0][0];
    expect(sent).toMatchObject({ channel: "email", target: "a@b.co", recipientUserId: "u1", dedupKey: `alumni.invite.fresh:${rows[1].id}` });
    expect(sent.bodyText).toContain("/alumni/invite/");
    expect(drainNow).toHaveBeenCalledWith(["ob1"]);
  });

  it("sends at most one fresh link per user in ten minutes", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    rows[0].expiresAt = ago(1000);
    rows[0].createdAt = ago(FRESH_LINK_COOLDOWN_MS + 1000);

    await sendFreshAlumniInvite(token);
    await sendFreshAlumniInvite(token);

    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
  });

  it("keeps the dedup key free of the token", async () => {
    const { token } = await createAlumniInvite({ userId: "u1", sentTo: "a@b.co" });
    rows[0].expiresAt = ago(1000);
    rows[0].createdAt = ago(FRESH_LINK_COOLDOWN_MS + 1000);
    await sendFreshAlumniInvite(token);
    const key = vi.mocked(enqueueOutbound).mock.calls[0][0].dedupKey!;
    expect(key).not.toContain(token);
    expect(key).not.toContain(rows[1].tokenHash);
  });
});

describe("sendLaunchInvite", () => {
  it("queues the template with the link and name, keyed by batch and user, without draining", async () => {
    vi.mocked(renderEmailTemplate).mockResolvedValue({ subject: "Hi", html: '<p><a href="https://x/y">Sign in</a></p>' });
    const result = await sendLaunchInvite({ userId: "u1", firstName: "Ada", address: "Ada@example.edu", batch: "b1" });

    expect(result).toEqual({ queued: true });
    const vars = vi.mocked(renderEmailTemplate).mock.calls[0];
    expect(vars[0]).toBe("alumni.invite");
    expect(vars[1]).toMatchObject({ firstName: "Ada", inviteLink: expect.stringContaining("/alumni/invite/") });
    expect(enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: "alumni.invite.launch:b1:u1", target: "ada@example.edu", subject: "Hi" }),
    );
    expect(drainNow).not.toHaveBeenCalled();
    expect(rows[0].batch).toBe("b1");
  });

  it("removes the invite when the email cannot be queued", async () => {
    vi.mocked(renderEmailTemplate).mockResolvedValue({ subject: "Hi", html: "<p>x</p>" });
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("boom"));
    await expect(sendLaunchInvite({ userId: "u1", firstName: "Ada", address: "a@b.co", batch: "b1" })).rejects.toThrow("boom");
    expect(rows).toHaveLength(0);

    vi.mocked(renderEmailTemplate).mockResolvedValue(null);
    expect(await sendLaunchInvite({ userId: "u1", firstName: "Ada", address: "a@b.co", batch: "b1" })).toEqual({ queued: false });
    expect(rows).toHaveLength(0);
  });
});
