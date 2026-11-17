import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  notify: vi.fn(),
  flag: vi.fn(),
  prisma: {
    cardStatementCharge: { findUnique: vi.fn() },
    notification: { findFirst: vi.fn() },
    expense: { findMany: vi.fn() },
    adminMembership: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/notify.server", () => ({ notify: m.notify }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: m.flag }));

import type { ExpenseViewer } from "../access";
import { requestReceipt, runUnpaidExpenseReminders } from "../reminders.server";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({ userId: "owner", isCore: false, isStaff: false, ownedCardIds: ["c1"], ...over });
const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch1",
  merchant: "Staples",
  amount: { toString: () => "12.50" },
  cardId: "c1",
  expense: null,
  card: { id: "c1", nickname: "Social", ownerId: "owner", holderIds: ["h1", "h2"] },
  ...over,
});
const NOW = new Date("2026-11-20T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.notify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
  m.flag.mockResolvedValue(true);
  m.prisma.cardStatementCharge.findUnique.mockResolvedValue(charge());
  m.prisma.notification.findFirst.mockResolvedValue(null);
});

describe("requestReceipt", () => {
  it("notifies holders but not the requester, linking to the charge", async () => {
    const res = await requestReceipt(viewer({ userId: "owner" }), "ch1", NOW);
    expect(res).toEqual({ notified: 2 });
    const arg = m.notify.mock.calls[0][0];
    expect(arg.eventType).toBe("expense.needs_receipt");
    expect(arg.recipients).toEqual([{ userId: "h1" }, { userId: "h2" }]);
    expect(arg.message.link).toBe("/expenses?charge=ch1");
    expect(arg.message.dedupKey).toMatch(/^expense-needs-receipt:ch1:/);
    expect(arg.message.title).toContain("$12.50");
  });

  it("includes the owner when Core asks", async () => {
    const res = await requestReceipt(viewer({ userId: "core", isCore: true, ownedCardIds: [] }), "ch1", NOW);
    expect(res.notified).toBe(3);
  });

  it("does not re-notify within 24 hours", async () => {
    m.prisma.notification.findFirst.mockResolvedValue({ id: "n1" });
    expect(await requestReceipt(viewer(), "ch1", NOW)).toEqual({ notified: 0 });
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.prisma.notification.findFirst.mock.calls[0][0].where.createdAt.gt).toEqual(new Date("2026-11-19T12:00:00Z"));
  });

  it("rejects people who neither own the card nor are Core", async () => {
    await expect(requestReceipt(viewer({ userId: "x", ownedCardIds: [] }), "ch1", NOW)).rejects.toMatchObject({ code: "not_found" });
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("rejects a missing charge and one that already has an expense", async () => {
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce(null);
    await expect(requestReceipt(viewer(), "nope", NOW)).rejects.toMatchObject({ code: "not_found" });
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce(charge({ expense: { id: "e1" } }));
    await expect(requestReceipt(viewer(), "ch1", NOW)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("runUnpaidExpenseReminders", () => {
  const exp = (id: string, daysAgo: number) => ({
    id,
    merchant: "Acme",
    total: { toString: () => "40.00" },
    decidedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    submitter: { firstName: "Ada", lastName: "Lovelace" },
  });

  beforeEach(() => {
    m.prisma.adminMembership.findMany.mockResolvedValue([{ userId: "s1" }, { userId: "s2" }]);
  });

  it("does nothing when the flag is off", async () => {
    m.flag.mockResolvedValue(false);
    const res = await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(res.items).toBe(0);
    expect(m.prisma.expense.findMany).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("selects approved own-card expenses decided before the cutoff", async () => {
    m.prisma.expense.findMany.mockResolvedValue([]);
    await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: { unpaidAfterDays: 7 } });
    expect(m.prisma.expense.findMany.mock.calls[0][0].where).toEqual({
      status: "APPROVED",
      paidWith: "OWN_CARD",
      decidedAt: { lte: new Date("2026-11-13T12:00:00Z") },
    });
  });

  it("defaults to 14 days", async () => {
    m.prisma.expense.findMany.mockResolvedValue([]);
    await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(m.prisma.expense.findMany.mock.calls[0][0].where.decidedAt.lte).toEqual(new Date("2026-11-06T12:00:00Z"));
  });

  it("notifies staff with a key that is stable within an interval and new in the next", async () => {
    m.prisma.expense.findMany.mockResolvedValue([exp("e1", 15)]);
    const res = await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(res.items).toBe(1);
    const first = m.notify.mock.calls[0][0];
    expect(first.eventType).toBe("expense.unpaid_reminder");
    expect(first.recipients).toEqual([{ userId: "s1" }, { userId: "s2" }]);
    expect(first.message.dedupKey).toBe("expense-unpaid:e1:1");
    expect(first.message.link).toBe("/expenses?expense=e1");

    m.prisma.expense.findMany.mockResolvedValue([exp("e1", 20)]);
    await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(m.notify.mock.calls[1][0].message.dedupKey).toBe("expense-unpaid:e1:1");

    m.prisma.expense.findMany.mockResolvedValue([exp("e1", 29)]);
    await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(m.notify.mock.calls[2][0].message.dedupKey).toBe("expense-unpaid:e1:2");
  });

  it("counts only expenses that produced a new notification", async () => {
    m.prisma.expense.findMany.mockResolvedValue([exp("e1", 15), exp("e2", 16)]);
    m.notify.mockResolvedValueOnce({ inApp: 0, emailed: 0, slackDmed: 0 }).mockResolvedValueOnce({ inApp: 2, emailed: 0, slackDmed: 0 });
    const res = await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(res.items).toBe(1);
  });

  it("skips notifying when there is no staff", async () => {
    m.prisma.expense.findMany.mockResolvedValue([exp("e1", 15)]);
    m.prisma.adminMembership.findMany.mockResolvedValue([]);
    await runUnpaidExpenseReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(m.notify).not.toHaveBeenCalled();
  });
});
