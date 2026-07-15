import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { JOBS, type JobDefinition } from "~/jobs/registry";
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
    });
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
