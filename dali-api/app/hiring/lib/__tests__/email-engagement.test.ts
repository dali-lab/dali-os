import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { mailMessageIndex: { findMany: vi.fn() } },
}));

import { prisma } from "~/lib/db";
import { getApplicantEmailEngagement } from "~/hiring/lib/email-engagement.server";

const db = prisma as unknown as { mailMessageIndex: { findMany: ReturnType<typeof vi.fn> } };

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
  db.mailMessageIndex.findMany.mockResolvedValue([]);
});

describe("getApplicantEmailEngagement", () => {
  it("returns zero totals and no threads when nothing is linked", async () => {
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement).toEqual({
      totals: { inbound: 0, outbound: 0, firstAt: null, lastAt: null },
      threads: [],
    });
  });

  it("groups messages by (accountId, threadId) and counts direction totals", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "t1", direction: "Inbound", subject: "Hi", sentAt: "2026-01-01T00:00:00Z" }),
      row({ id: "m2", threadId: "t1", direction: "Outbound", subject: "Re: Hi", sentAt: "2026-01-02T00:00:00Z" }),
      row({ id: "m3", threadId: "t2", direction: "Inbound", subject: "Question", sentAt: "2026-01-03T00:00:00Z" }),
    ]);

    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });

    expect(engagement.totals).toEqual({
      inbound: 2,
      outbound: 1,
      firstAt: "2026-01-01T00:00:00.000Z",
      lastAt: "2026-01-03T00:00:00.000Z",
    });
    expect(engagement.threads).toHaveLength(2);
  });

  it("orders threads newest-last-activity first", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "older", direction: "Inbound", sentAt: "2026-01-01T00:00:00Z" }),
      row({ id: "m2", threadId: "newer", direction: "Inbound", sentAt: "2026-01-05T00:00:00Z" }),
    ]);

    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads.map((t) => t.indexId)).toEqual(["m2", "m1"]);
  });

  it("uses the newest message in a thread as its indexId and subject", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "t1", direction: "Inbound", subject: "Original", sentAt: "2026-01-01T00:00:00Z" }),
      row({ id: "m2", threadId: "t1", direction: "Outbound", subject: "Re: Original", sentAt: "2026-01-02T00:00:00Z" }),
    ]);

    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0]).toMatchObject({ indexId: "m2", subject: "Re: Original" });
  });

  it("strips subject and indexId, and never exposes accountId/threadId, while blinded", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      row({ id: "m1", threadId: "t1", direction: "Inbound", subject: "Secret subject", sentAt: "2026-01-01T00:00:00Z" }),
    ]);

    const engagement = await getApplicantEmailEngagement("u1", { blinded: true });

    expect(engagement.threads[0].subject).toBeNull();
    expect(engagement.threads[0].indexId).toBeNull();
    const serialized = JSON.stringify(engagement);
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("threadId");
    expect(serialized).not.toContain("Secret subject");
  });
});
