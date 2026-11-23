import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { scheduledJob: { findMany: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/jobs/registry", () => ({
  JOBS: [],
  resolveJobSettings: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { JOBS, resolveJobSettings } from "~/jobs/registry";
import { runListJobs, LIST_JOBS_TOOL } from "~/mcp/tools/admin/list-jobs";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as { scheduledJob: { findMany: ReturnType<typeof vi.fn> } };

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: { id: userId, daliEmail: null, dartmouthEmail: null, netId: null, firstName: "Core", lastName: "Lead" },
    scopes: ["mcp:read"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.scheduledJob.findMany.mockResolvedValue([]);
});

it("is a read tool", () => {
  expect(LIST_JOBS_TOOL.requiredScope).toBe("mcp:read");
});

describe("list_jobs", () => {
  it("returns an empty jobs array when registry is empty", async () => {
    // JOBS mock array is already [] from beforeEach
    const out = await runListJobs(makeCtx());
    expect(out).toEqual({ jobs: [] });
    expect(mockPrisma.scheduledJob.findMany).toHaveBeenCalled();
  });

  it("returns merged job state from registry + DB rows", async () => {
    // Temporarily push a job def into the mocked JOBS array
    (JOBS as unknown[]).push({
      name: "daily-digest",
      description: "Daily digest job",
      intervalMinutes: 60,
      settings: [],
      handler: vi.fn(),
    });

    const dbRow = {
      name: "daily-digest",
      intervalMinutes: 90,
      enabled: false,
      nextRunAt: new Date("2026-01-01T00:00:00Z"),
      lastRunAt: new Date("2025-12-31T00:00:00Z"),
      lastStatus: "ok",
      lastError: null,
      settings: {},
    };
    mockPrisma.scheduledJob.findMany.mockResolvedValue([dbRow]);
    vi.mocked(resolveJobSettings).mockReturnValue({ maxRecipients: 100 });

    const out = await runListJobs(makeCtx());

    expect(out).toMatchObject({
      jobs: [
        {
          name: "daily-digest",
          description: "Daily digest job",
          intervalMinutes: 90,
          enabled: false,
          nextRunAt: "2026-01-01T00:00:00.000Z",
          lastRunAt: "2025-12-31T00:00:00.000Z",
          lastStatus: "ok",
          lastError: null,
          settings: { maxRecipients: 100 },
        },
      ],
    });

    // Clean up
    (JOBS as unknown[]).splice(0);
  });

  it("uses registry defaults when no DB row exists", async () => {
    (JOBS as unknown[]).push({
      name: "notify-digest",
      description: "Notification digest",
      intervalMinutes: 30,
      settings: [],
      handler: vi.fn(),
    });
    mockPrisma.scheduledJob.findMany.mockResolvedValue([]);
    vi.mocked(resolveJobSettings).mockReturnValue({});

    const out = await runListJobs(makeCtx());
    expect(out).toMatchObject({
      jobs: [
        {
          name: "notify-digest",
          intervalMinutes: 30,
          enabled: true,
          nextRunAt: null,
          lastRunAt: null,
          lastStatus: null,
          lastError: null,
        },
      ],
    });

    (JOBS as unknown[]).splice(0);
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runListJobs(makeCtx("u-nobody")),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(mockPrisma.scheduledJob.findMany).not.toHaveBeenCalled();
  });
});
