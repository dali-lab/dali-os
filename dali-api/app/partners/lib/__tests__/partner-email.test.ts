import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mailAccount: { findFirst: vi.fn() },
    mailMessageIndex: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { PARTNERS_FROM_EMAIL } from "~/lib/app-env";
import { getPartnerContactEmailThreads, canViewPartnerThread } from "~/partners/lib/partner-email.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function row(o: {
  id: string;
  accountId?: string;
  threadId: string;
  direction: "Inbound" | "Outbound";
  subject?: string;
  sentAt: string;
}) {
  return {
    id: o.id,
    accountId: o.accountId ?? "acc1",
    threadId: o.threadId,
    direction: o.direction,
    subject: o.subject ?? "Hello",
    sentAt: new Date(o.sentAt),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.mailAccount.findFirst.mockResolvedValue({ id: "acc1" });
  db.mailMessageIndex.findMany.mockResolvedValue([]);
  db.mailMessageIndex.findUnique.mockResolvedValue(null);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("getPartnerContactEmailThreads", () => {
  it("returns no threads when the partners@ account doesn't exist", async () => {
    db.mailAccount.findFirst.mockResolvedValue(null);
    const threads = await getPartnerContactEmailThreads("pc1", { accountAddress: PARTNERS_FROM_EMAIL });
    expect(threads).toEqual([]);
    expect(db.mailMessageIndex.findMany).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the partners@ MailAccount, case-insensitively", async () => {
    await getPartnerContactEmailThreads("pc1", { accountAddress: "Partners@DALI.Dartmouth.edu" });
    expect(db.mailAccount.findFirst.mock.calls[0][0].where).toMatchObject({
      kind: "Shared",
      address: PARTNERS_FROM_EMAIL,
    });
  });

  it("groups messages by thread and counts direction totals", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "t1", direction: "Inbound", subject: "Hi", sentAt: "2026-01-01T00:00:00Z" }),
      row({ id: "m2", threadId: "t1", direction: "Outbound", subject: "Re: Hi", sentAt: "2026-01-02T00:00:00Z" }),
      row({ id: "m3", threadId: "t2", direction: "Inbound", subject: "Question", sentAt: "2026-01-03T00:00:00Z" }),
    ]);

    const threads = await getPartnerContactEmailThreads("pc1");

    expect(threads).toHaveLength(2);
    const t1 = threads.find((t) => t.indexId === "m2")!;
    expect(t1).toMatchObject({ subject: "Re: Hi", inbound: 1, outbound: 1, messageCount: 2 });
  });

  it("orders threads newest-last-activity first", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "older", direction: "Inbound", sentAt: "2026-01-01T00:00:00Z" }),
      row({ id: "m2", threadId: "newer", direction: "Inbound", sentAt: "2026-01-05T00:00:00Z" }),
    ]);

    const threads = await getPartnerContactEmailThreads("pc1");
    expect(threads.map((t) => t.indexId)).toEqual(["m2", "m1"]);
  });

  it("scopes the index query to the partners@ account and this contact", async () => {
    await getPartnerContactEmailThreads("pc1");
    expect(db.mailMessageIndex.findMany.mock.calls[0][0].where).toMatchObject({
      accountId: "acc1",
      linkedPartnerContactId: "pc1",
    });
  });
});

describe("canViewPartnerThread", () => {
  it("is false for a non-Core viewer", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    db.mailMessageIndex.findUnique.mockResolvedValue({ account: { address: PARTNERS_FROM_EMAIL } });
    expect(await canViewPartnerThread("u1", "idx1")).toBe(false);
  });

  it("is false when the index row doesn't exist", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue(null);
    expect(await canViewPartnerThread("u1", "idx1")).toBe(false);
  });

  it("is false when the row is on a different Shared inbox", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue({ account: { address: "applications@dali.dartmouth.edu" } });
    expect(await canViewPartnerThread("u1", "idx1")).toBe(false);
  });

  it("is true for a Core viewer on a partners@ row", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue({ account: { address: PARTNERS_FROM_EMAIL } });
    expect(await canViewPartnerThread("u1", "idx1")).toBe(true);
  });
});
