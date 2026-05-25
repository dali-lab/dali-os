import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/hiring/routes/lead.intern-to-full-cycle.$id";

const CORE_ID = "core-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle = {
    update: vi.fn().mockResolvedValue({}),
  };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, email: "core@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request(`http://localhost/hiring/lead/intern-to-full-cycle/${CYCLE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function callAction(form: Record<string, string>) {
  return action({
    request: makeRequest(form),
    params: { id: CYCLE_ID },
    context: {},
  } as any);
}

describe("lead.intern-to-full-cycle.$id action — set-close-date", () => {
  it("returns 403 when caller is not core", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = await callAction({ intent: "set-close-date", closeDate: "2026-06-01" });
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("stores the picked date as 11:59:59 PM ET (EDT) as a UTC instant", async () => {
    await callAction({ intent: "set-close-date", closeDate: "2026-06-01" });

    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: CYCLE_ID });
    const stored = updateArgs.data.closeDate as Date;
    expect(stored).toBeInstanceOf(Date);
    // 2026-06-01 23:59:59 EDT (UTC-4) === 2026-06-02 03:59:59 UTC.
    expect(stored.toISOString()).toBe("2026-06-02T03:59:59.000Z");
  });

  it("clears the close date when the picker is empty", async () => {
    await callAction({ intent: "set-close-date", closeDate: "" });

    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
    expect(updateArgs.data.closeDate).toBeNull();
  });
});
