import { describe, expect, it, vi } from "vitest";
vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));
vi.mock("~/education/lib/attendance.server", () => ({ saveAttendance: vi.fn() }));

import { CHECK_IN_GRACE_MS, isManualCheckInOpen } from "../check-in-window";
import { isSessionCheckInOpen } from "~/education/lib/session-checkin.server";


const endsAt = new Date("2026-10-14T18:00:00Z");
const opened = new Date("2026-10-14T16:00:00Z");

describe("isManualCheckInOpen", () => {
  it("is closed when check-in was never opened", () => {
    expect(isManualCheckInOpen({ checkInOpenAt: null, endsAt }, new Date("2026-10-14T17:00:00Z"))).toBe(false);
  });

  it("is open until the grace window ends, inclusive", () => {
    const edge = new Date(endsAt.getTime() + CHECK_IN_GRACE_MS);
    expect(isManualCheckInOpen({ checkInOpenAt: opened, endsAt }, edge)).toBe(true);
  });

  it("closes 1 ms after the grace window", () => {
    const after = new Date(endsAt.getTime() + CHECK_IN_GRACE_MS + 1);
    expect(isManualCheckInOpen({ checkInOpenAt: opened, endsAt }, after)).toBe(false);
  });

  it("takes a custom grace", () => {
    expect(isManualCheckInOpen({ checkInOpenAt: opened, endsAt }, new Date(endsAt.getTime() + 1), 0)).toBe(false);
  });
});

describe("isSessionCheckInOpen", () => {
  const datetime = new Date("2026-10-14T15:00:00Z");

  it("treats a session with no end as three hours long", () => {
    const edge = new Date(datetime.getTime() + 3 * 3600_000 + CHECK_IN_GRACE_MS);
    expect(isSessionCheckInOpen({ datetime, endsAt: null, checkInOpenAt: opened }, edge)).toBe(true);
    expect(isSessionCheckInOpen({ datetime, endsAt: null, checkInOpenAt: opened }, new Date(edge.getTime() + 1))).toBe(false);
  });

  it("uses the real end when there is one", () => {
    const now = new Date(endsAt.getTime() + CHECK_IN_GRACE_MS + 1);
    expect(isSessionCheckInOpen({ datetime, endsAt, checkInOpenAt: opened }, now)).toBe(false);
  });
});
