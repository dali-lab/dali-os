// Google-sourced calendar content is the member's own; an impersonating admin
// gets none of it. Lab-native hits (meetings they were invited to) stay.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockFetchBusyEvents = vi.hoisted(() => vi.fn());
const mockSearchCalendarEvents = vi.hoisted(() => vi.fn());

// isImpersonating / forbiddenWhileImpersonating stay real — they are what's under test.
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: mockRequireAuth,
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/google-calendar", () => ({
  fetchBusyEvents: mockFetchBusyEvents,
  searchCalendarEvents: mockSearchCalendarEvents,
}));
vi.mock("~/lib/db", () => ({
  prisma: { notification: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import { loader as busyLoader } from "~/calendar/routes/api.google-calendar.busy";
import { loader as searchLoader } from "~/calendar/routes/api.calendar.search";

function session(impersonatedBy?: string) {
  return {
    ok: true,
    user: { sub: "member-1", email: "m@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
    ...(impersonatedBy ? { impersonatedBy } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchBusyEvents.mockResolvedValue([{ start: "x", end: "y", title: "Therapy" }]);
  mockSearchCalendarEvents.mockResolvedValue([]);
});

describe("GET /api/google-calendar/busy while impersonating", () => {
  const url = "http://x/api/google-calendar/busy?start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z";

  it("403s and never reaches Google", async () => {
    mockRequireAuth.mockResolvedValue(session("admin-9"));

    const res = await busyLoader({ request: new Request(url) } as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "impersonating" });
    expect(mockFetchBusyEvents).not.toHaveBeenCalled();
  });

  it("serves the member's own session normally", async () => {
    mockRequireAuth.mockResolvedValue(session());

    const res = await busyLoader({ request: new Request(url) } as never);

    expect(res.status).toBe(200);
    expect(mockFetchBusyEvents).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/calendar/search while impersonating", () => {
  const url = "http://x/api/calendar/search?q=therapy";

  it("hides the Google half and never reaches Google", async () => {
    mockRequireAuth.mockResolvedValue(session("admin-9"));

    const res = await searchLoader({ request: new Request(url) } as never);
    const body = await res.json();

    expect(body.google).toEqual([]);
    expect(body.googleHidden).toBe("impersonating");
    expect(mockSearchCalendarEvents).not.toHaveBeenCalled();
    // Lab-native meeting search is not personal content and stays available.
    expect(body).toHaveProperty("local");
  });

  it("searches Google for the member's own session", async () => {
    mockRequireAuth.mockResolvedValue(session());

    const res = await searchLoader({ request: new Request(url) } as never);
    const body = await res.json();

    expect(body.googleHidden).toBeUndefined();
    expect(mockSearchCalendarEvents).toHaveBeenCalledTimes(1);
  });
});
