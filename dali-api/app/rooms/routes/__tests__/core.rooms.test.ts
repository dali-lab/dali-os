import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { room: { findMany: vi.fn() } } }));
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
