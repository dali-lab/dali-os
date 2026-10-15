import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn() }));
vi.mock("~/hiring/lib/interview-availability.server", () => ({ interviewerCalendars: vi.fn() }));
vi.mock("~/hiring/lib/scheduling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hiring/lib/scheduling")>()),
  explainAvailableSlots: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";
import { explainAvailableSlots } from "~/hiring/lib/scheduling";
import { loader } from "~/hiring/routes/api.cycles.$cycleId.coverage";

const mockPrisma = prisma as unknown as {
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findMany: ReturnType<typeof vi.fn> };
  interview: { findMany: ReturnType<typeof vi.fn> };
  domainApplicationCycle: { findMany: ReturnType<typeof vi.fn> };
};

const CONFIG = {
  slotDurationMinutes: 30,
  bufferMinutes: 0,
  dayStartHour: 9,
  dayEndHour: 10,
  interviewStartDate: new Date("2030-04-15T04:00:00Z"),
  interviewEndDate: new Date("2030-04-15T04:00:00Z"),
  timezone: "America/New_York",
};

function run() {
  return loader({
    request: new Request("http://localhost/api/hiring/cycles/cycle1/coverage"),
    params: { cycleId: "cycle1" },
    context: {},
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interviewConfig = { findUnique: vi.fn().mockResolvedValue(CONFIG) };
  (mockPrisma as any).cycleInterviewer = { findMany: vi.fn().mockResolvedValue([]) };
  (mockPrisma as any).interview = { findMany: vi.fn().mockResolvedValue([]) };
  (mockPrisma as any).domainApplicationCycle = {
    findMany: vi.fn().mockResolvedValue([
      { domainId: "design", domain: { name: "Design" } },
      { domainId: "dev", domain: { name: "Developer" } },
    ]),
  };
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead1" } } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(interviewerCalendars).mockResolvedValue(new Map());
});

describe("coverage loader", () => {
  it("reports what each cycle domain's applicants can book in person, with the blocker", async () => {
    vi.mocked(explainAvailableSlots).mockImplementation(async (_cycleId, domainIds) =>
      domainIds[0] === "dev"
        ? { slots: [{ startTime: "a", endTime: "b" }], blocker: null, bookingNoticeHours: 12 }
        : { slots: [], blocker: "no-cross-domain-interviewer", bookingNoticeHours: 12 },
    );

    const body = await (await run()).json();

    expect(body.configured).toBe(true);
    expect(body.domains).toEqual([
      { domainId: "design", domainName: "Design", bookableSlotCount: 0, blocker: "no-cross-domain-interviewer", bookingNoticeHours: 12 },
      { domainId: "dev", domainName: "Developer", bookableSlotCount: 1, blocker: null, bookingNoticeHours: 12 },
    ]);
    expect(explainAvailableSlots).toHaveBeenCalledWith("cycle1", ["design"], "in-person");
    expect(explainAvailableSlots).toHaveBeenCalledWith("cycle1", ["dev"], "in-person");
  });

  it("returns no domains when the cycle has no interview config", async () => {
    mockPrisma.interviewConfig.findUnique.mockResolvedValue(null);
    const body = await (await run()).json();
    expect(body).toMatchObject({ configured: false, domains: [] });
    expect(explainAvailableSlots).not.toHaveBeenCalled();
  });

  it("refuses members without cycle access", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    expect((await run()).status).toBe(403);
  });
});
