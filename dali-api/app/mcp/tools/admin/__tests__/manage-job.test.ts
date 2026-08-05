import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledJob: { update: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/jobs/registry", () => ({
  jobByName: vi.fn(),
}));
vi.mock("~/jobs/runner.server", () => ({
  runJob: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { jobByName } from "~/jobs/registry";
import { runJob } from "~/jobs/runner.server";
import { logAuditEvent } from "~/lib/audit";
import { runManageJob, MANAGE_JOB_TOOL } from "~/mcp/tools/admin/manage-job";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  scheduledJob: { update: ReturnType<typeof vi.fn> };
};

const MOCK_DEF = {
  name: "daily-digest",
  description: "Daily digest job",
  intervalMinutes: 60,
  settings: [
    { key: "maxRecipients", label: "Max recipients", unit: "users", min: 1, max: 500, default: 100 },
  ],
  handler: vi.fn(),
};

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(jobByName).mockReturnValue(MOCK_DEF as any);
  vi.mocked(runJob).mockResolvedValue({ ran: true });
  mockPrisma.scheduledJob.update.mockResolvedValue({});
});

describe("manage_job", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_JOB_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not isCore", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageJob(makeCtx("u-nobody"), { action: "run", name: "daily-digest" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(runJob).not.toHaveBeenCalled();
  });

  describe("action: run", () => {
    it("runs the named job and returns ok", async () => {
      const out = await runManageJob(makeCtx(), { action: "run", name: "daily-digest" });
      expect(out).toEqual({ ok: true, error: null });
      expect(runJob).toHaveBeenCalledWith("daily-digest", { force: true });
    });

    it("logs an audit event after a successful run", async () => {
      await runManageJob(makeCtx(), { action: "run", name: "daily-digest" });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "jobs.run", targetId: "daily-digest" }),
      );
    });

    it("throws McpInvalidError when the lease is held (ran: false)", async () => {
      vi.mocked(runJob).mockResolvedValue({ ran: false, error: "Lease held" });
      await expect(
        runManageJob(makeCtx(), { action: "run", name: "daily-digest" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpNotFoundError for an unknown job name", async () => {
      vi.mocked(jobByName).mockReturnValue(undefined);
      await expect(
        runManageJob(makeCtx(), { action: "run", name: "ghost-job" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
      expect(runJob).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError when name is missing", async () => {
      await expect(
        runManageJob(makeCtx(), { action: "run" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });

  describe("action: set_config", () => {
    it("updates enabled flag and logs an audit event", async () => {
      const out = await runManageJob(makeCtx(), {
        action: "set_config",
        name: "daily-digest",
        enabled: false,
      });
      expect(out).toEqual({ ok: true });
      expect(mockPrisma.scheduledJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: "daily-digest" }, data: { enabled: false } }),
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "jobs.toggle", targetId: "daily-digest" }),
      );
    });

    it("updates intervalMinutes independently", async () => {
      await runManageJob(makeCtx(), {
        action: "set_config",
        name: "daily-digest",
        intervalMinutes: 120,
      });
      expect(mockPrisma.scheduledJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { intervalMinutes: 120 } }),
      );
    });

    it("validates settings against the job definition", async () => {
      // Valid setting value
      await runManageJob(makeCtx(), {
        action: "set_config",
        name: "daily-digest",
        settings: { maxRecipients: 200 },
      });
      expect(mockPrisma.scheduledJob.update).toHaveBeenCalled();
    });

    it("throws McpInvalidError for an out-of-range setting value", async () => {
      await expect(
        runManageJob(makeCtx(), {
          action: "set_config",
          name: "daily-digest",
          settings: { maxRecipients: 9999 },
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(mockPrisma.scheduledJob.update).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError for an unknown setting key", async () => {
      await expect(
        runManageJob(makeCtx(), {
          action: "set_config",
          name: "daily-digest",
          settings: { unknownKey: 5 },
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpInvalidError when nothing to update", async () => {
      await expect(
        runManageJob(makeCtx(), { action: "set_config", name: "daily-digest" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpInvalidError for intervalMinutes out of range", async () => {
      await expect(
        runManageJob(makeCtx(), {
          action: "set_config",
          name: "daily-digest",
          intervalMinutes: 99999,
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpNotFoundError for an unknown job name", async () => {
      vi.mocked(jobByName).mockReturnValue(undefined);
      await expect(
        runManageJob(makeCtx(), { action: "set_config", name: "ghost-job", enabled: true }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });
});
