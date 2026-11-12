import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const notifySessionReminder = vi.fn();
vi.mock("~/education/lib/notifications.server", () => ({
  notifySessionReminder: (...a: unknown[]) => notifySessionReminder(...a),
}));

import { mockedPrisma } from "~/test-utils/prisma";
import { runSessionReminderSweep } from "../session-reminder-sweep.server";

const db = mockedPrisma();
const NOW = new Date("2026-11-07T17:00:00Z");
const ctx = (leadHours = 24) => ({ now: NOW, lastSuccessAt: null, settings: { leadHours } });

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sequence: 2,
  title: "Intro",
  datetime: new Date("2026-11-08T10:00:00Z"),
  location: "Baker 101",
  offeringId: "o1",
  offering: { title: "Design 101" },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.educationSession.findMany.mockResolvedValue([] as never);
  notifySessionReminder.mockResolvedValue(undefined);
});

describe("session-reminder-sweep", () => {
  it("queries the lead window with the unsent, published, open filters and a batch cap", async () => {
    await runSessionReminderSweep(ctx(12));
    expect(db.educationSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reminderSentAt: null,
          datetime: { gt: NOW, lte: new Date(NOW.getTime() + 12 * 3_600_000) },
          offering: { status: "Published", closedOutAt: null },
        },
        take: 50,
      }),
    );
  });

  it("maps the session fields onto the notify payload", async () => {
    db.educationSession.findMany.mockResolvedValue([session("s1")] as never);
    await runSessionReminderSweep(ctx());
    expect(notifySessionReminder).toHaveBeenCalledWith({
      sessionId: "s1",
      offeringId: "o1",
      offeringTitle: "Design 101",
      sequence: 2,
      sessionTitle: "Intro",
      datetime: new Date("2026-11-08T10:00:00Z"),
      location: "Baker 101",
    });
  });

  it("stamps reminderSentAt only after notify resolves", async () => {
    const order: string[] = [];
    notifySessionReminder.mockImplementation(async () => {
      order.push("notify");
    });
    db.educationSession.update.mockImplementation((async () => {
      order.push("stamp");
    }) as never);
    db.educationSession.findMany.mockResolvedValue([session("s1")] as never);
    const result = await runSessionReminderSweep(ctx());
    expect(order).toEqual(["notify", "stamp"]);
    expect(db.educationSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { reminderSentAt: NOW } });
    expect(result.items).toBe(1);
  });

  it("does not stamp a session whose notify throws, and still sends the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    notifySessionReminder.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    db.educationSession.findMany.mockResolvedValue([session("bad"), session("good")] as never);
    const result = await runSessionReminderSweep(ctx());
    expect(db.educationSession.update).toHaveBeenCalledTimes(1);
    expect(db.educationSession.update).toHaveBeenCalledWith({ where: { id: "good" }, data: { reminderSentAt: NOW } });
    expect(result.items).toBe(1);
  });

  it("sends nothing when the filter returns no sessions (already stamped)", async () => {
    const result = await runSessionReminderSweep(ctx());
    expect(notifySessionReminder).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
