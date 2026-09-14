import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: {
    timeEntry: { findMany: vi.fn() },
    userAvailabilitySettings: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ getRoleLabel: vi.fn(), getUserRoleInstances: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: vi.fn((_req: Request, res: Response) => res),
  handlePreflight: vi.fn(() => null),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { getRoleLabel, getUserRoleInstances } from "~/lib/roles";
import { loader } from "~/routes/api.timesheets.export";

const findEntries = prisma.timeEntry.findMany as unknown as ReturnType<typeof vi.fn>;

type Entry = {
  date: Date;
  hours: number;
  note: string | null;
  startTime: Date | null;
  endTime: Date | null;
  assignmentType: string | null;
  roleRefId: string | null;
};

function entry(startIso: string, hours: number, roleRefId: string | null = "pa1", note = "Work"): Entry {
  const startTime = new Date(startIso);
  return {
    date: startTime,
    hours,
    note,
    startTime,
    endTime: new Date(startTime.getTime() + hours * 3_600_000),
    assignmentType: roleRefId ? "Project" : null,
    roleRefId,
  };
}

async function get(query = "") {
  const res = await loader({
    request: new Request(`http://localhost/api/timesheets/export${query}`),
  } as never);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-10T16:00:00Z"));
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(prisma.userAvailabilitySettings.findUnique).mockResolvedValue(
    { timezone: "America/New_York" } as never,
  );
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ timeZone: null } as never);
  vi.mocked(getRoleLabel).mockImplementation(async (_t, id) => (id === "pa1" ? "DALI OS Developer" : "Core"));
  vi.mocked(getUserRoleInstances).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/timesheets/export", () => {
  it("lists the role's pay periods newest first and exports the latest", async () => {
    findEntries.mockResolvedValue([
      // Aug 16 – Aug 29 period
      entry("2026-08-18T18:00:00Z", 2),
      // Aug 30 – Sep 12 period (current)
      entry("2026-09-01T18:00:00Z", 1.5),
      entry("2026-09-02T13:30:00Z", 3),
    ]);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.hireKey).toBe("pa1");
    expect(body.periods).toEqual([
      expect.objectContaining({ key: "2026-08-30", end: "2026-09-12", hours: 4.5, entryCount: 2, current: true }),
      expect.objectContaining({ key: "2026-08-16", end: "2026-08-29", hours: 2, entryCount: 1, current: false }),
    ]);
    expect(body.periodKey).toBe("2026-08-30");
    expect(body.entries).toHaveLength(2);
  });

  it("emits wall-clock times in the timesheet zone, not UTC", async () => {
    findEntries.mockResolvedValue([entry("2026-09-01T18:00:00Z", 2)]);

    const { body } = await get();

    expect(body.entries[0]).toEqual({
      date: "2026-09-01",
      start: "14:00",
      end: "16:00",
      hours: 2,
      description: "Work",
    });
  });

  it("files a late-evening entry under its local day's period", async () => {
    // Sat Aug 29, 10pm ET = Sun Aug 30 02:00Z — belongs to the Aug 16 period.
    findEntries.mockResolvedValue([entry("2026-08-30T02:00:00Z", 1)]);

    const { body } = await get();

    expect(body.periods.map((p: { key: string }) => p.key)).toEqual(["2026-08-16"]);
    expect(body.entries[0]).toMatchObject({ date: "2026-08-29", start: "22:00" });
  });

  it("selects the period containing ?period, listing it even when empty", async () => {
    findEntries.mockResolvedValue([entry("2026-08-18T18:00:00Z", 2)]);

    const { body } = await get("?period=2026-09-03");

    expect(body.periodKey).toBe("2026-08-30");
    expect(body.periods.map((p: { key: string }) => p.key)).toEqual(["2026-08-30", "2026-08-16"]);
    expect(body.entries).toEqual([]);
  });

  it("scopes periods and entries to the chosen ?hire", async () => {
    findEntries.mockResolvedValue([
      entry("2026-09-01T18:00:00Z", 2, "pa1"),
      entry("2026-08-18T18:00:00Z", 1, "ca1", "Core sync"),
    ]);

    const { body } = await get("?hire=ca1");

    expect(body.hireLabel).toBe("Core");
    expect(body.availableHires.map((h: { key: string }) => h.key)).toEqual(["pa1", "ca1"]);
    expect(body.periods.map((p: { key: string }) => p.key)).toEqual(["2026-08-16"]);
    expect(body.entries).toEqual([expect.objectContaining({ description: "Core sync" })]);
  });

  it("returns an empty picker instead of a 404 when nothing is logged", async () => {
    findEntries.mockResolvedValue([]);
    vi.mocked(getUserRoleInstances).mockResolvedValue([
      { assignmentType: "Project", roleRefId: "pa9", label: "New Project Developer" } as never,
    ]);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.availableHires).toEqual([{ key: "pa9", label: "New Project Developer" }]);
    expect(body.periods).toEqual([]);
    expect(body.periodKey).toBeNull();
    expect(body.entries).toEqual([]);
  });
});
