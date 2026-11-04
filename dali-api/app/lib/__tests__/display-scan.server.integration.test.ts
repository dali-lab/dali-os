import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { getActiveDisplayScan, startDisplayScan, stopDisplayScan } from "~/lib/display-scan.server";
import { makeMeeting, makeUser } from "../../../integration/factories-misc";

const NOW = new Date("2026-10-01T12:00:00Z");
const OCC = new Date("2026-10-01T12:00:00Z");
const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("startDisplayScan", () => {
  it("creates one session expiring 12h out for an unscheduled event", async () => {
    const u = await makeUser();
    const m = await makeMeeting(u.id);
    const res = await startDisplayScan(m.id, OCC, u.id);
    expect(res).toMatchObject({ ok: true, displaced: null });
    const rows = await prisma.displayScanSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.getTime()).toBe(NOW.getTime() + 12 * HOUR);
    expect(rows[0].startedByUserId).toBe(u.id);
  });

  it("404s for a missing meeting", async () => {
    expect(await startDisplayScan("nope", OCC, "u")).toMatchObject({ ok: false, status: 404 });
  });

  it("concurrent starts by two events: one wins, the other is refused, one session remains", async () => {
    const u = await makeUser();
    const a = await makeMeeting(u.id, { title: "A" });
    const b = await makeMeeting(u.id, { title: "B" });
    const [ra, rb] = await Promise.all([startDisplayScan(a.id, OCC, u.id), startDisplayScan(b.id, OCC, u.id)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    expect(loser).toMatchObject({ ok: false, status: 409 });
    const rows = await prisma.displayScanSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledMeetingId).toBe(ra.ok ? a.id : b.id);
  });

  it("restarting the same occurrence is idempotent", async () => {
    const u = await makeUser();
    const m = await makeMeeting(u.id);
    await startDisplayScan(m.id, OCC, u.id);
    expect(await startDisplayScan(m.id, OCC, u.id)).toMatchObject({ ok: true, displaced: null });
    expect(await prisma.displayScanSession.count()).toBe(1);
  });

  it("takeOver replaces the live session and names the displaced event", async () => {
    const u = await makeUser();
    const a = await makeMeeting(u.id, { title: "A" });
    const b = await makeMeeting(u.id, { title: "B" });
    await startDisplayScan(a.id, OCC, u.id);
    expect(await startDisplayScan(b.id, OCC, u.id, { takeOver: true })).toMatchObject({ ok: true, displaced: "A" });
    const rows = await prisma.displayScanSession.findMany();
    expect(rows.map((r) => r.scheduledMeetingId)).toEqual([b.id]);
  });

  it("a lapsed session does not block a new event and is cleared", async () => {
    const u = await makeUser();
    const a = await makeMeeting(u.id);
    const b = await makeMeeting(u.id);
    await prisma.displayScanSession.create({
      data: { scheduledMeetingId: a.id, occurrenceStart: OCC, expiresAt: new Date(NOW.getTime() - 1000) },
    });
    expect(await startDisplayScan(b.id, OCC, u.id)).toMatchObject({ ok: true, displaced: null });
    expect((await prisma.displayScanSession.findMany()).map((r) => r.scheduledMeetingId)).toEqual([b.id]);
  });
});

describe("getActiveDisplayScan / stopDisplayScan", () => {
  it("returns the newest unexpired session with the starter's name, ignoring expired ones", async () => {
    const u = await makeUser({ firstName: "Ada", lastName: "Lovelace" });
    const m = await makeMeeting(u.id, { title: "Lab night" });
    expect(await getActiveDisplayScan(NOW)).toBeNull();
    await startDisplayScan(m.id, OCC, u.id);
    expect(await getActiveDisplayScan(NOW)).toMatchObject({
      meetingId: m.id,
      title: "Lab night",
      isEvent: true,
      startedBy: "Ada Lovelace",
    });
    expect(await getActiveDisplayScan(new Date(NOW.getTime() + 13 * HOUR))).toBeNull();
  });

  it("stop scoped to a meeting leaves another meeting's session; unscoped stops all", async () => {
    const u = await makeUser();
    const a = await makeMeeting(u.id);
    const b = await makeMeeting(u.id);
    for (const m of [a, b])
      await prisma.displayScanSession.create({
        data: { scheduledMeetingId: m.id, occurrenceStart: OCC, expiresAt: new Date(NOW.getTime() + HOUR) },
      });
    await stopDisplayScan(a.id);
    expect((await prisma.displayScanSession.findMany()).map((r) => r.scheduledMeetingId)).toEqual([b.id]);
    await stopDisplayScan();
    expect(await prisma.displayScanSession.count()).toBe(0);
  });
});
