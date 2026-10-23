import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    room: { findMany: vi.fn(), count: vi.fn() },
    roomDisplay: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/room-display.server", () => ({ createDisplaySetupCode: vi.fn() }));
vi.mock("~/lib/display-scan.server", () => ({ getActiveDisplayScan: vi.fn(), stopDisplayScan: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { getActiveDisplayScan, stopDisplayScan } from "~/lib/display-scan.server";
import { createDisplaySetupCode } from "~/lib/room-display.server";
import { action, loader } from "~/rooms/routes/core.rooms";

const occurrenceStart = new Date("2026-09-30T22:00:00Z");
const scan = {
  meetingId: "m9",
  occurrenceStart,
  title: "Project sync",
  start: occurrenceStart,
  end: new Date("2026-09-30T23:00:00Z"),
  isEvent: false,
  startedBy: "Ada Lovelace",
  expiresAt: new Date("2026-09-30T23:15:00Z"),
};

function load() {
  return loader({ request: new Request("http://localhost/core/rooms"), params: {}, context: {} } as never);
}
function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/core/rooms", { method: "POST", body }),
    params: {},
    context: {},
  } as never);
}
function stop() {
  const body = new FormData();
  body.set("intent", "stop-display-scan");
  return action({
    request: new Request("http://localhost/core/rooms", { method: "POST", body }),
    params: {},
    context: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1", type: "member" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(prisma.room.findMany).mockResolvedValue([]);
  vi.mocked(getActiveDisplayScan).mockResolvedValue(null);
});

describe("Core ▸ Rooms iPad scan", () => {
  it("shows nothing when no scan is live", async () => {
    expect((await load()).activeScan).toBeNull();
  });

  it("names the live scan, who started it, and links to the event", async () => {
    vi.mocked(getActiveDisplayScan).mockResolvedValue(scan);
    expect((await load()).activeScan).toEqual({
      title: "Project sync",
      href: `/calendar/meeting/m9?occurrence=${encodeURIComponent(occurrenceStart.toISOString())}`,
      startedBy: "Ada Lovelace",
      expiresAt: "2026-09-30T23:15:00.000Z",
    });
  });

  it("stops whatever is live and audits which event lost the iPads", async () => {
    vi.mocked(getActiveDisplayScan).mockResolvedValue(scan);
    expect(await stop()).toEqual({ ok: true });
    expect(stopDisplayScan).toHaveBeenCalledWith();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "room.display.scan.stop",
        userId: "core-1",
        targetId: "m9",
        metadata: { title: "Project sync", occurrenceStart: occurrenceStart.toISOString() },
      }),
    );
  });

  it("is a no-op when the scan already lapsed", async () => {
    expect(await stop()).toEqual({ ok: true });
    expect(stopDisplayScan).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(getActiveDisplayScan).mockResolvedValue(scan);
    await expect(stop()).rejects.toMatchObject({ status: 302 });
    expect(stopDisplayScan).not.toHaveBeenCalled();
  });
});

describe("Core ▸ Rooms two-room displays", () => {
  beforeEach(() => {
    vi.mocked(prisma.room.count).mockResolvedValue(2);
    vi.mocked(createDisplaySetupCode).mockResolvedValue({
      displayId: "d1",
      code: "ABCD2345",
      expiresAt: new Date("2026-10-23T12:10:00Z"),
    });
  });

  it("mints a setup code for a display showing both rooms", async () => {
    const res = await submit({ intent: "add-display", roomId: "r1", secondRoomId: "r2", label: "Fishbowl door" });
    expect(res).toMatchObject({ ok: true, setup: { label: "Fishbowl door" } });
    expect(createDisplaySetupCode).toHaveBeenCalledWith("r1", "Fishbowl door", "core-1", "r2");
  });

  it("requires the other room", async () => {
    const res = (await submit({ intent: "add-display", roomId: "r1", label: "Door" })) as Response;
    expect(res.status).toBe(400);
    expect(createDisplaySetupCode).not.toHaveBeenCalled();
  });

  it("won't pair a room with itself", async () => {
    const res = (await submit({ intent: "add-display", roomId: "r1", secondRoomId: "r1", label: "Door" })) as Response;
    expect(res.status).toBe(400);
    expect(createDisplaySetupCode).not.toHaveBeenCalled();
  });

  it("refuses an archived or missing room", async () => {
    vi.mocked(prisma.room.count).mockResolvedValue(1);
    const res = (await submit({ intent: "add-display", roomId: "r1", secondRoomId: "r2", label: "Door" })) as Response;
    expect(res.status).toBe(404);
    expect(vi.mocked(prisma.room.count).mock.calls[0]![0]).toEqual({
      where: { id: { in: ["r1", "r2"] }, archivedAt: null },
    });
  });

  it("gives an existing display its second room without re-pairing", async () => {
    vi.mocked(prisma.roomDisplay.findUnique).mockResolvedValue({ roomId: "r1", revokedAt: null } as never);
    expect(await submit({ intent: "update-display", id: "d1", secondRoomId: "r2", label: "Door" })).toEqual({ ok: true });
    expect(prisma.roomDisplay.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { label: "Door", secondRoomId: "r2" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "room.display.update", targetId: "d1" }));
  });

  it("404s editing a removed display", async () => {
    vi.mocked(prisma.roomDisplay.findUnique).mockResolvedValue({ roomId: "r1", revokedAt: new Date() } as never);
    const res = (await submit({ intent: "update-display", id: "d1", secondRoomId: "r2", label: "Door" })) as Response;
    expect(res.status).toBe(404);
    expect(prisma.roomDisplay.update).not.toHaveBeenCalled();
  });

  it("lists each display's second room", async () => {
    vi.mocked(prisma.room.findMany).mockResolvedValue([
      {
        id: "r1",
        name: "Fishbowl",
        description: null,
        capacity: 8,
        archivedAt: null,
        displays: [
          {
            id: "d1",
            label: "Door",
            activatedAt: new Date(),
            lastSeenAt: new Date(),
            appVersion: null,
            setupCodeExpiresAt: null,
            secondRoom: { id: "r2", name: "Garage" },
          },
        ],
      },
    ] as never);
    const { rooms } = await load();
    expect(rooms[0]!.displays[0]!.secondRoom).toEqual({ id: "r2", name: "Garage" });
  });
});
