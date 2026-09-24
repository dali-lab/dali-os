import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    roomDisplay: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { hashCode } from "~/lib/pairing";
import { redeemDisplaySetupCode, requireRoomDisplay } from "~/lib/room-display.server";

const rd = prisma.roomDisplay as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  rd.update.mockResolvedValue({});
  rd.updateMany.mockResolvedValue({ count: 1 });
});

describe("redeemDisplaySetupCode", () => {
  const live = { id: "d1", revokedAt: null, setupCodeExpiresAt: new Date(Date.now() + 60_000) };

  it("mints a token for a valid code, matching however it was typed", async () => {
    rd.findUnique.mockResolvedValue(live);
    const res = await redeemDisplaySetupCode("abcd-2345");
    expect(res).toMatchObject({ displayId: "d1" });
    expect(rd.findUnique.mock.calls[0]![0].where.setupCodeHash).toBe(hashCode("ABCD2345"));
    // The stored token is the hash of what we handed back, and the code is burned.
    const data = rd.updateMany.mock.calls[0]![0].data;
    expect(data.tokenHash).toBe(hashCode(res!.token));
    expect(data.setupCodeHash).toBeNull();
  });

  it("rejects an expired code", async () => {
    rd.findUnique.mockResolvedValue({ ...live, setupCodeExpiresAt: new Date(Date.now() - 1) });
    expect(await redeemDisplaySetupCode("ABCD2345")).toBeNull();
    expect(rd.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a code already redeemed (hash cleared → no row)", async () => {
    rd.findUnique.mockResolvedValue(null);
    expect(await redeemDisplaySetupCode("ABCD2345")).toBeNull();
  });

  it("rejects a revoked display's code", async () => {
    rd.findUnique.mockResolvedValue({ ...live, revokedAt: new Date() });
    expect(await redeemDisplaySetupCode("ABCD2345")).toBeNull();
  });

  it("loses a concurrent redeem race cleanly", async () => {
    rd.findUnique.mockResolvedValue(live);
    rd.updateMany.mockResolvedValue({ count: 0 });
    expect(await redeemDisplaySetupCode("ABCD2345")).toBeNull();
  });
});

describe("requireRoomDisplay", () => {
  const req = (auth?: string) =>
    new Request("http://localhost/api/room-display/schedule", {
      headers: auth ? { Authorization: auth } : {},
    });
  const row = {
    id: "d1",
    label: "Door",
    revokedAt: null,
    lastSeenAt: new Date(),
    room: { id: "r1", name: "Lab", description: null, capacity: 8, archivedAt: null },
  };

  it("accepts a RoomDisplay token and looks it up by hash", async () => {
    rd.findUnique.mockResolvedValue(row);
    const display = await requireRoomDisplay(req("RoomDisplay tok123"));
    expect(display).toEqual({
      id: "d1",
      label: "Door",
      room: { id: "r1", name: "Lab", description: null, capacity: 8 },
    });
    expect(rd.findUnique.mock.calls[0]![0].where.tokenHash).toBe(hashCode("tok123"));
  });

  it("ignores Bearer (user session) and missing headers", async () => {
    expect(await requireRoomDisplay(req("Bearer tok123"))).toBeNull();
    expect(await requireRoomDisplay(req())).toBeNull();
    expect(rd.findUnique).not.toHaveBeenCalled();
  });

  it("rejects revoked displays and archived rooms", async () => {
    rd.findUnique.mockResolvedValueOnce({ ...row, revokedAt: new Date() });
    expect(await requireRoomDisplay(req("RoomDisplay tok123"))).toBeNull();
    rd.findUnique.mockResolvedValueOnce({ ...row, room: { ...row.room, archivedAt: new Date() } });
    expect(await requireRoomDisplay(req("RoomDisplay tok123"))).toBeNull();
  });

  it("throttles lastSeenAt writes", async () => {
    rd.findUnique.mockResolvedValue(row);
    await requireRoomDisplay(req("RoomDisplay tok123"));
    expect(rd.update).not.toHaveBeenCalled();
    rd.findUnique.mockResolvedValue({ ...row, lastSeenAt: new Date(Date.now() - 10 * 60_000) });
    await requireRoomDisplay(req("RoomDisplay tok123"));
    expect(rd.update).toHaveBeenCalledTimes(1);
  });
});
