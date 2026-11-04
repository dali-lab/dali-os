import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { mailMessageIndex: { findMany: vi.fn() } },
}));

import { prisma } from "~/lib/db.server";
import { APPLICATIONS_FROM_EMAIL } from "~/lib/app-env";
import { getApplicantEmailEngagement, getEngagementSummaries } from "~/hiring/lib/email-engagement.server";

const db = prisma as unknown as { mailMessageIndex: { findMany: ReturnType<typeof vi.fn> } };

function row(o: {
  id: string;
  accountId?: string;
  threadId: string;
  direction: "Inbound" | "Outbound";
  autoReply?: boolean | null;
  subject?: string;
  sentAt: string;
  linkedUserId?: string;
}) {
  return {
    id: o.id,
    accountId: o.accountId ?? "acc1",
    threadId: o.threadId,
    direction: o.direction,
    autoReply: o.autoReply === undefined ? false : o.autoReply,
    subject: o.subject ?? "Hello",
    sentAt: new Date(o.sentAt),
    linkedUserId: o.linkedUserId ?? "u1",
  };
}

const inbound = (id: string, threadId: string, sentAt: string, extra: Partial<Parameters<typeof row>[0]> = {}) =>
  row({ id, threadId, direction: "Inbound", sentAt, ...extra });
const outbound = (id: string, threadId: string, sentAt: string, extra: Partial<Parameters<typeof row>[0]> = {}) =>
  row({ id, threadId, direction: "Outbound", sentAt, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  db.mailMessageIndex.findMany.mockResolvedValue([]);
});

describe("getApplicantEmailEngagement", () => {
  it("returns zero totals and no threads when nothing is linked", async () => {
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement).toEqual({
      totals: { fromThem: 0, threadsStarted: 0, lastFromThemAt: null },
      threads: [],
    });
  });

  it("scopes to another inbox when accountAddress is given", async () => {
    await getApplicantEmailEngagement("u1", { blinded: false, accountAddress: "partners@x.edu" });
    expect(db.mailMessageIndex.findMany.mock.calls[0][0].where.account).toEqual({
      address: { equals: "partners@x.edu", mode: "insensitive" },
    });
  });

  it("reports raw inbound and outbound counts per thread alongside what's theirs", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      outbound("m1", "t1", "2026-01-01T00:00:00Z"),
      inbound("m2", "t1", "2026-01-01T00:05:00Z", { autoReply: true }),
      inbound("m3", "t1", "2026-01-02T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0]).toMatchObject({ inbound: 2, outbound: 1, fromThem: 1, messages: 3 });
  });

  it("queries the user's linked rows on applications@, oldest-first", async () => {
    await getApplicantEmailEngagement("u1", { blinded: false });
    expect(db.mailMessageIndex.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { linkedUserId: "u1", account: { address: { equals: APPLICATIONS_FROM_EMAIL, mode: "insensitive" } } },
        orderBy: { sentAt: "asc" },
      }),
    );
  });

  it("hides threads made only of our outbound mail", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      outbound("m1", "confirm", "2026-01-01T00:00:00Z"),
      outbound("m2", "reminder", "2026-01-02T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads).toEqual([]);
    expect(engagement.totals).toEqual({ fromThem: 0, threadsStarted: 0, lastFromThemAt: null });
  });

  it("hides threads whose only inbound mail is an auto-reply", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      outbound("m1", "t1", "2026-01-01T00:00:00Z"),
      inbound("m2", "t1", "2026-01-01T00:05:00Z", { autoReply: true }),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads).toEqual([]);
    expect(engagement.totals.fromThem).toBe(0);
  });

  it("counts unchecked inbound rows (autoReply null) as theirs", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([inbound("m1", "t1", "2026-01-01T00:00:00Z", { autoReply: null })]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.totals.fromThem).toBe(1);
  });

  it("marks a thread they opened as started by them", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z"),
      outbound("m2", "t1", "2026-01-02T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0]).toMatchObject({ startedByThem: true, fromThem: 1, messages: 2 });
    expect(engagement.totals.threadsStarted).toBe(1);
  });

  it("keeps a reply to our automated mail as engagement, not a thread they started", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      outbound("m1", "t1", "2026-01-01T00:00:00Z"),
      inbound("m2", "t1", "2026-01-02T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads).toHaveLength(1);
    expect(engagement.threads[0]).toMatchObject({ startedByThem: false, fromThem: 1, messages: 2 });
    expect(engagement.totals).toEqual({
      fromThem: 1,
      threadsStarted: 0,
      lastFromThemAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("does not count a thread as started by them when it opens with their auto-reply", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { autoReply: true }),
      inbound("m2", "t1", "2026-01-02T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0]).toMatchObject({ startedByThem: false, fromThem: 1, messages: 2 });
  });

  it("sums their mail across threads and reports the latest one they sent", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z"),
      outbound("m2", "t1", "2026-01-02T00:00:00Z"),
      inbound("m3", "t2", "2026-01-03T00:00:00Z"),
      inbound("m4", "t1", "2026-01-04T00:00:00Z"),
      outbound("m5", "t2", "2026-01-09T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.totals).toEqual({
      fromThem: 3,
      threadsStarted: 2,
      lastFromThemAt: "2026-01-04T00:00:00.000Z",
    });
  });

  it("groups by (accountId, threadId), not threadId alone", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { accountId: "a" }),
      inbound("m2", "t1", "2026-01-02T00:00:00Z", { accountId: "b" }),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads).toHaveLength(2);
  });

  it("orders threads by latest activity, newest first", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "older", "2026-01-01T00:00:00Z"),
      inbound("m2", "newer", "2026-01-05T00:00:00Z"),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads.map((t) => t.indexId)).toEqual(["m2", "m1"]);
  });

  it("uses the newest message in a thread for its indexId, subject and last date", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { subject: "Original" }),
      outbound("m2", "t1", "2026-01-02T00:00:00Z", { subject: "Re: Original" }),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0]).toMatchObject({
      indexId: "m2",
      subject: "Re: Original",
      firstAt: "2026-01-01T00:00:00.000Z",
      lastAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("keeps an earlier subject when a later message has none", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { subject: "Original" }),
      inbound("m2", "t1", "2026-01-02T00:00:00Z", { subject: "" }),
    ]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: false });
    expect(engagement.threads[0].subject).toBe("Original");
  });

  it("strips subject and thread pointer when blinded but keeps counts", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([inbound("m1", "t1", "2026-01-01T00:00:00Z", { subject: "Secret" })]);
    const engagement = await getApplicantEmailEngagement("u1", { blinded: true });
    expect(engagement.threads[0]).toMatchObject({ indexId: null, subject: null, fromThem: 1, startedByThem: true });
    expect(engagement.totals.fromThem).toBe(1);
  });
});

describe("getEngagementSummaries", () => {
  it("skips the query for an empty list", async () => {
    expect((await getEngagementSummaries([])).size).toBe(0);
    expect(db.mailMessageIndex.findMany).not.toHaveBeenCalled();
  });

  it("queries each user once", async () => {
    await getEngagementSummaries(["u1", "u2", "u1"]);
    expect(db.mailMessageIndex.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          linkedUserId: { in: ["u1", "u2"] },
          account: { address: { equals: APPLICATIONS_FROM_EMAIL, mode: "insensitive" } },
        },
        orderBy: { sentAt: "asc" },
      }),
    );
  });

  it("summarizes per user and omits users who never wrote to us", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { linkedUserId: "u1" }),
      outbound("m2", "t2", "2026-01-01T00:00:00Z", { linkedUserId: "u1" }),
      inbound("m3", "t2", "2026-01-02T00:00:00Z", { linkedUserId: "u1" }),
      outbound("m4", "t3", "2026-01-01T00:00:00Z", { linkedUserId: "u2" }),
      inbound("m5", "t3", "2026-01-01T00:05:00Z", { linkedUserId: "u2", autoReply: true }),
    ]);
    const summaries = await getEngagementSummaries(["u1", "u2"]);
    expect(summaries.get("u1")).toEqual({
      fromThem: 2,
      threadsStarted: 1,
      lastFromThemAt: "2026-01-02T00:00:00.000Z",
    });
    expect(summaries.has("u2")).toBe(false);
  });

  it("treats the same thread id under two users as separate threads", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      inbound("m1", "t1", "2026-01-01T00:00:00Z", { linkedUserId: "u1" }),
      inbound("m2", "t1", "2026-01-02T00:00:00Z", { linkedUserId: "u2" }),
    ]);
    const summaries = await getEngagementSummaries(["u1", "u2"]);
    expect(summaries.get("u1")?.threadsStarted).toBe(1);
    expect(summaries.get("u2")?.threadsStarted).toBe(1);
  });
});
