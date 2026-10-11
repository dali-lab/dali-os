import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loader } from "~/hiring/routes/events.check-in.$eventId";

const EVENT_ID = "evt-1";
const USER_ID = "applicant-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as {
  hiringEvent: { findUnique: ReturnType<typeof vi.fn> };
  hiringEventAttendance: { findUnique: ReturnType<typeof vi.fn> };
  application: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVENT_ID,
    title: "Application help hour",
    kind: "HelpHour",
    startsAt: new Date("2026-10-14T20:00:00.000Z"),
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
    location: "DALI Lab",
    checkInOpenAt: new Date(),
    applicationCycle: { id: CYCLE_ID, name: "Fall 2026", applicants: "Students" },
    ...overrides,
  };
}

function run(eventId: string = EVENT_ID) {
  const request = new Request(`http://localhost/hiring/events/check-in/${eventId}`);
  return loader({ request, params: { eventId }, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).hiringEvent = { findUnique: vi.fn().mockResolvedValue(baseEvent()) };
  (mockPrisma as any).hiringEventAttendance = { findUnique: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).application = { findUnique: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).user = { findUnique: vi.fn().mockResolvedValue({ timeZone: null }) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "applicant@dartmouth.edu", type: "dartmouth" },
  } as never);
  vi.mocked(getUserRoles).mockResolvedValue({} as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
});

describe("loader /hiring/events/check-in/:eventId", () => {
  it("redirects to login when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
  });

  it("404s when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await expect(run()).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.hiringEvent.findUnique).not.toHaveBeenCalled();
  });

  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });

  it("is open when check-in is open and we're inside the grace window", async () => {
    const data = (await run()) as any;
    expect(data.open).toBe(true);
    expect(data.alreadyPresent).toBe(false);
  });

  it("is closed when check-in was never opened", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(baseEvent({ checkInOpenAt: null }));
    const data = (await run()) as any;
    expect(data.open).toBe(false);
  });

  it("is closed once the event's grace window has elapsed", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(
      baseEvent({ endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );
    const data = (await run()) as any;
    expect(data.open).toBe(false);
  });

  it("reports alreadyPresent when an attendance row exists", async () => {
    mockPrisma.hiringEventAttendance.findUnique.mockResolvedValue({ id: "att-1" });
    const data = (await run()) as any;
    expect(data.alreadyPresent).toBe(true);
  });

  it("gives an apply link when the viewer has no Application in this cycle", async () => {
    mockPrisma.application.findUnique.mockResolvedValue(null);
    const data = (await run()) as any;
    expect(data.applyHref).toBe(`/portal/apply/${CYCLE_ID}`);
  });

  it("omits the apply link once the viewer has started an application", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({ id: "app-1" });
    const data = (await run()) as any;
    expect(data.applyHref).toBeNull();
  });
});
