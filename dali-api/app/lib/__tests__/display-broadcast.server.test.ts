import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { getBroadcastEvent } from "~/lib/display-broadcast.server";

const mockPrisma = prisma as unknown as {
  hiringEvent: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBroadcastEvent", () => {
  const now = new Date("2026-10-14T20:30:00Z");
  const base = { title: "Help hour", kind: "HelpHour", location: null, checkInOpenAt: new Date("2026-10-14T19:00:00Z") };

  it("returns null when nothing is broadcasting", async () => {
    mockPrisma.hiringEvent.findMany.mockResolvedValue([]);
    expect(await getBroadcastEvent(now)).toBeNull();
    expect(mockPrisma.hiringEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { broadcastAt: { not: null }, checkInOpenAt: { not: null } } }),
    );
  });

  it("skips an event whose check-in window has lapsed and picks the soonest live one", async () => {
    mockPrisma.hiringEvent.findMany.mockResolvedValue([
      { ...base, id: "stale", startsAt: new Date("2026-10-14T15:00:00Z"), endsAt: new Date("2026-10-14T16:00:00Z") },
      { ...base, id: "live", startsAt: new Date("2026-10-14T20:00:00Z"), endsAt: new Date("2026-10-14T22:00:00Z") },
      { ...base, id: "later", startsAt: new Date("2026-10-14T23:00:00Z"), endsAt: new Date("2026-10-15T00:00:00Z") },
    ]);
    const result = await getBroadcastEvent(now);
    expect(result?.id).toBe("live");
    expect(result).not.toHaveProperty("checkInOpenAt");
  });
});
