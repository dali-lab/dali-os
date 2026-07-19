import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { JOBS, resolveJobSettings, type JobDefinition } from "~/jobs/registry";
import { tick, runJob } from "~/jobs/runner.server";

const mockPrisma = prisma as unknown as {
  scheduledJob: Record<string, ReturnType<typeof vi.fn>>;
};

// The registry is a module-level list; tests swap in fakes and restore.
const savedJobs = [...JOBS];
let handler: ReturnType<typeof vi.fn>;

function fakeJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: "test-job",
    description: "test",
    intervalMinutes: 5,
    handler: handler as unknown as JobDefinition["handler"],
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-job",
    enabled: true,
    intervalMinutes: 5,
    settings: {},
    nextRunAt: new Date("2026-07-15T12:00:00Z"),
    lockedUntil: null,
    lastRunAt: null,
    lastSuccessAt: new Date("2026-07-14T12:00:00Z"),
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    ...overrides,
  };
}

const NOW = new Date("2026-07-15T12:01:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  handler = vi.fn().mockResolvedValue({ items: 3 });
  JOBS.splice(0, JOBS.length, fakeJob());
  mockPrisma.scheduledJob.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.scheduledJob.findMany.mockResolvedValue([jobRow()]);
  mockPrisma.scheduledJob.findUnique.mockResolvedValue(jobRow());
  mockPrisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.scheduledJob.update.mockResolvedValue({});
});

afterEach(() => {
  JOBS.splice(0, JOBS.length, ...savedJobs);
});

describe("tick", () => {
  it("self-heals registry rows every tick", async () => {
    await tick(NOW);
    expect(mockPrisma.scheduledJob.createMany).toHaveBeenCalledWith({
      data: [{ name: "test-job", intervalMinutes: 5 }],
      skipDuplicates: true,
    });
  });

  it("claims via CAS and runs the handler with the row's lastSuccessAt", async () => {
    const ran = await tick(NOW);
    expect(ran).toEqual(["test-job"]);

    expect(mockPrisma.scheduledJob.updateMany).toHaveBeenCalledWith({
      where: {
        name: "test-job",
        enabled: true,
        nextRunAt: { lte: NOW },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: NOW } }],
      },
      data: { lockedUntil: new Date(NOW.getTime() + 5 * 60_000) },
    });
    expect(handler).toHaveBeenCalledWith({
      now: NOW,
      lastSuccessAt: new Date("2026-07-14T12:00:00Z"),
      settings: {},
    });
  });

  it("advances nextRunAt from the ROW's interval, not the registry default", async () => {
    mockPrisma.scheduledJob.findMany.mockResolvedValue([
      jobRow({ intervalMinutes: 45 }), // operator edited; registry default is 5
    ]);
    await tick(NOW);
    expect(mockPrisma.scheduledJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: new Date(NOW.getTime() + 45 * 60_000),
        }),
      }),
    );
  });

  it("resolves declared settings from the row, falling back per-key", async () => {
    JOBS.splice(
      0,
      JOBS.length,
      fakeJob({
        settings: [
          { key: "leadMinutes", label: "Lead", unit: "min", min: 1, max: 720, default: 15 },
          { key: "cap", label: "Cap", unit: "", min: 1, max: 500, default: 200 },
        ],
      }),
    );
    mockPrisma.scheduledJob.findMany.mockResolvedValue([
      // leadMinutes valid override; cap out of range → default wins.
      jobRow({ settings: { leadMinutes: 30, cap: 9999, unknown: 1 } }),
    ]);
    await tick(NOW);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { leadMinutes: 30, cap: 200 } }),
    );
  });

  it("skips the handler when another machine wins the claim", async () => {
    mockPrisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    const ran = await tick(NOW);
    expect(ran).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("writes success bookkeeping, advances nextRunAt, releases the lease", async () => {
    await tick(NOW);
    expect(mockPrisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { name: "test-job" },
      data: expect.objectContaining({
        lastRunAt: NOW,
        lastSuccessAt: NOW,
        lastStatus: "Success",
        lastError: null,
        nextRunAt: new Date(NOW.getTime() + 5 * 60_000),
        lockedUntil: null,
      }),
    });
  });

  it("records a truncated error, still advances nextRunAt, keeps lastSuccessAt", async () => {
    handler.mockRejectedValue(new Error("x".repeat(2000)));
    await tick(NOW);
    const { data } = mockPrisma.scheduledJob.update.mock.calls[0][0];
    expect(data.lastStatus).toBe("Error");
    expect(data.lastError).toHaveLength(1000);
    expect(data.nextRunAt).toEqual(new Date(NOW.getTime() + 5 * 60_000));
    expect(data.lockedUntil).toBeNull();
    expect(data.lastSuccessAt).toBeUndefined();
  });

  it("ignores rows for jobs no longer in the registry", async () => {
    mockPrisma.scheduledJob.findMany.mockResolvedValue([jobRow({ name: "ghost" })]);
    const ran = await tick(NOW);
    expect(ran).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("runJob", () => {
  it("force-runs without the nextRunAt predicate but keeps the lease predicate", async () => {
    const result = await runJob("test-job", { force: true });
    expect(result).toEqual({ ran: true });

    const claim = mockPrisma.scheduledJob.updateMany.mock.calls[0][0];
    expect(claim.where.nextRunAt).toBeUndefined();
    expect(claim.where.enabled).toBeUndefined();
    expect(claim.where.OR).toEqual([
      { lockedUntil: null },
      { lockedUntil: { lt: expect.any(Date) } },
    ]);
    expect(handler).toHaveBeenCalled();
  });

  it("refuses to overlap an in-flight run", async () => {
    mockPrisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    const result = await runJob("test-job", { force: true });
    expect(result.ran).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects unknown jobs", async () => {
    const result = await runJob("nope", { force: true });
    expect(result).toEqual({ ran: false, error: 'Unknown job "nope"' });
  });

  it("surfaces the handler error while reporting the run happened", async () => {
    handler.mockRejectedValue(new Error("boom"));
    const result = await runJob("test-job", { force: true });
    expect(result).toEqual({ ran: true, error: "boom" });
  });
});

describe("resolveJobSettings", () => {
  const def = fakeJob({
    settings: [
      { key: "hours", label: "Hours", unit: "h", min: 0, max: 24, default: 2 },
    ],
  });

  it("uses stored values when valid, defaults otherwise", () => {
    expect(resolveJobSettings(def, { hours: 5 })).toEqual({ hours: 5 });
    expect(resolveJobSettings(def, { hours: 99 })).toEqual({ hours: 2 });
    expect(resolveJobSettings(def, { hours: "5" })).toEqual({ hours: 2 });
    expect(resolveJobSettings(def, null)).toEqual({ hours: 2 });
    expect(resolveJobSettings(def, { other: 1 })).toEqual({ hours: 2 });
  });

  it("returns an empty object for jobs with no declared settings", () => {
    expect(resolveJobSettings(fakeJob(), { anything: 1 })).toEqual({});
  });
});
