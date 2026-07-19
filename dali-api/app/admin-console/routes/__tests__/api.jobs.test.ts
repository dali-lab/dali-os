import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  isAdmin: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/jobs/runner.server", () => ({ runJob: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { runJob } from "~/jobs/runner.server";
import { action } from "~/admin-console/routes/api.jobs.$name";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockIsAdmin = isAdmin as ReturnType<typeof vi.fn>;
const mockRunJob = runJob as ReturnType<typeof vi.fn>;

function patch(name: string, body: unknown) {
  const request = new Request(`http://localhost/api/jobs/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { name }, context: {} } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "admin-1", type: "member" } });
  mockIsAdmin.mockResolvedValue(true);
  mockPrisma.scheduledJob.update.mockResolvedValue({});
  mockRunJob.mockResolvedValue({ ran: true });
});

describe("PATCH /api/jobs/:name", () => {
  it("updates enabled, interval, and valid settings together", async () => {
    const res = await patch("meeting-reminders", {
      enabled: false,
      intervalMinutes: 10,
      settings: { leadMinutes: 30 },
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { name: "meeting-reminders" },
      data: { enabled: false, intervalMinutes: 10, settings: { leadMinutes: 30 } },
    });
  });

  it("rejects a setting the job does not declare", async () => {
    const res = await patch("meeting-reminders", { settings: { nonsense: 5 } });
    expect(res.status).toBe(400);
    expect(mockPrisma.scheduledJob.update).not.toHaveBeenCalled();
  });

  it("rejects out-of-range setting values with the declared bounds", async () => {
    const res = await patch("meeting-reminders", { settings: { leadMinutes: 9999 } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("between 1 and 720");
  });

  it("rejects an out-of-range interval", async () => {
    const res = await patch("meeting-reminders", { intervalMinutes: 0 });
    expect(res.status).toBe(400);
  });

  it("404s unknown jobs and 403s non-admins", async () => {
    let res = await patch("nope", { enabled: true });
    expect(res.status).toBe(404);

    mockIsAdmin.mockResolvedValue(false);
    res = await patch("meeting-reminders", { enabled: true });
    expect(res.status).toBe(403);
  });
});
