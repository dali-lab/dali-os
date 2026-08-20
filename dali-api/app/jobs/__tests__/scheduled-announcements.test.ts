import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/announcements.server", () => ({ sendAnnouncement: vi.fn() }));

import { prisma } from "~/lib/db";
import { sendAnnouncement } from "~/lib/announcements.server";
import { runScheduledAnnouncements } from "~/jobs/scheduled-announcements.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockSend = sendAnnouncement as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T12:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "sa1",
    createdByUserId: "core-1",
    title: "Lab meeting moved",
    body: null,
    bodyHtml: null,
    link: null,
    kind: "SystemAnnouncement",
    isTodo: true,
    dueAt: null,
    formId: null,
    ccDartmouth: false,
    allMembers: true,
    groupIds: [],
    userIds: [],
    sendAt: new Date(NOW.getTime() - 60_000),
    sentAt: null,
    canceledAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.scheduledAnnouncement.findMany.mockResolvedValue([row()]);
  mockPrisma.scheduledAnnouncement.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.scheduledAnnouncement.update.mockResolvedValue({});
  mockSend.mockResolvedValue({ ok: true, count: 12 });
});

describe("runScheduledAnnouncements", () => {
  it("CAS-claims sentAt BEFORE fanning out, then records sentCount", async () => {
    const callOrder: string[] = [];
    mockPrisma.scheduledAnnouncement.updateMany.mockImplementation(() => {
      callOrder.push("claim");
      return Promise.resolve({ count: 1 });
    });
    mockSend.mockImplementation(() => {
      callOrder.push("send");
      return Promise.resolve({ ok: true, count: 12 });
    });

    const result = await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(callOrder).toEqual(["claim", "send"]);
    expect(mockPrisma.scheduledAnnouncement.updateMany).toHaveBeenCalledWith({
      where: { id: "sa1", sentAt: null, canceledAt: null },
      data: { sentAt: NOW },
    });
    expect(mockPrisma.scheduledAnnouncement.update).toHaveBeenCalledWith({
      where: { id: "sa1" },
      data: { sentCount: 12, lastError: null },
    });
    expect(result.items).toBe(1);
  });

  it("passes the stored rich-text bodyHtml through to the fan-out", async () => {
    mockPrisma.scheduledAnnouncement.findMany.mockResolvedValue([
      row({ body: "Read this (https://x.com)", bodyHtml: '<p>Read <a href="https://x.com">this</a></p>' }),
    ]);
    await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Read this (https://x.com)",
        bodyHtml: '<p>Read <a href="https://x.com">this</a></p>',
      }),
    );
  });

  it("replays the stored ccDartmouth flag through the fan-out", async () => {
    mockPrisma.scheduledAnnouncement.findMany.mockResolvedValue([row({ ccDartmouth: true })]);
    await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ ccDartmouth: true }));
  });

  it("skips rows lost to a concurrent claim or cancel (no double fan-out)", async () => {
    mockPrisma.scheduledAnnouncement.updateMany.mockResolvedValue({ count: 0 });
    const result = await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("records lastError (and does not send) when the fire-time validation fails", async () => {
    mockSend.mockResolvedValue({
      ok: false,
      error: "Attach a published form (publish it first).",
      status: 400,
    });
    const result = await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockPrisma.scheduledAnnouncement.update).toHaveBeenCalledWith({
      where: { id: "sa1" },
      data: { lastError: "Attach a published form (publish it first)." },
    });
    expect(result.items).toBe(0);
  });

  it("records a thrown error on the claimed row", async () => {
    mockSend.mockRejectedValue(new Error("db down"));
    const result = await runScheduledAnnouncements({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockPrisma.scheduledAnnouncement.update).toHaveBeenCalledWith({
      where: { id: "sa1" },
      data: { lastError: "db down" },
    });
    expect(result.items).toBe(0);
  });
});
