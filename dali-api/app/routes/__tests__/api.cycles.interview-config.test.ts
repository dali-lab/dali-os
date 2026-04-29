import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth");
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { action } from "~/routes/api.cycles.$cycleId.interview-config";

const mockPrisma = prisma as unknown as {
  interviewConfig: {
    upsert: ReturnType<typeof vi.fn>;
  };
};

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";

const BASE_BODY = {
  slotDurationMinutes: 30,
  bufferMinutes: 15,
  dayStartHour: 9,
  dayEndHour: 18,
  interviewStartDate: "2026-05-01T00:00:00.000Z",
  interviewEndDate: "2026-05-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interviewConfig = { upsert: vi.fn().mockResolvedValue({ id: "config-1" }) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
});

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/interview-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/cycles/:cycleId/interview-config — timezone validation", () => {
  it("accepts a valid IANA timezone and persists it", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, timezone: "America/Los_Angeles" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interviewConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.update.timezone).toBe("America/Los_Angeles");
    expect(call.create.timezone).toBe("America/Los_Angeles");
  });

  it("returns 400 and does not upsert when timezone is invalid", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, timezone: "America/New_Yorq" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/timezone/i);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("falls back to America/New_York when timezone is omitted", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interviewConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.update.timezone).toBe("America/New_York");
    expect(call.create.timezone).toBe("America/New_York");
  });
});
