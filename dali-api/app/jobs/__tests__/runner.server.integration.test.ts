import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { JOBS, type JobDefinition } from "~/jobs/registry";
import { runJob, startJobRunner, tick } from "~/jobs/runner.server";

const savedJobs = [...JOBS];
const NOW = new Date("2026-07-15T12:00:00Z");
const minutes = (n: number) => n * 60_000;

let handler: ReturnType<typeof vi.fn>;

function fakeJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: "test-job",
    description: "test",
    intervalMinutes: 5,
    handler: (ctx) => handler(ctx),
    ...overrides,
  };
}

function seedRow(overrides: Record<string, unknown> = {}) {
  return prisma.scheduledJob.create({
    data: {
      name: "test-job",
      intervalMinutes: 5,
      nextRunAt: new Date(NOW.getTime() - minutes(1)),
      ...overrides,
    },
  });
}

const row = (name = "test-job") => prisma.scheduledJob.findUniqueOrThrow({ where: { name } });

beforeEach(() => {
  handler = vi.fn().mockResolvedValue({ items: 1 });
  JOBS.splice(0, JOBS.length, fakeJob());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  JOBS.splice(0, JOBS.length, ...savedJobs);
  vi.restoreAllMocks();
});

describe("tick lease", () => {
  it("lets exactly one of two concurrent ticks run a due job", async () => {
    await seedRow();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    handler.mockImplementation(async () => {
      await gate;
      return { items: 1 };
    });

    const a = tick(NOW);
    const b = tick(NOW);
    // Both ticks have read the row; the loser's CAS fails while the winner holds the lease.
    await vi.waitFor(async () => expect((await row()).lockedUntil).not.toBeNull());
    await new Promise((r) => setTimeout(r, 150));
    release();
    const results = await Promise.all([a, b]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.flat()).toEqual(["test-job"]);
  });

  it("runs a due job once even when many machines tick at once", async () => {
    await seedRow();
    const results = await Promise.all(Array.from({ length: 6 }, () => tick(NOW)));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.flat()).toEqual(["test-job"]);
  });

  it("does not claim a job whose lease is held and unexpired", async () => {
    const lockedUntil = new Date(NOW.getTime() + minutes(2));
    await seedRow({ lockedUntil });

    expect(await tick(NOW)).toEqual([]);

    expect(handler).not.toHaveBeenCalled();
    expect((await row()).lockedUntil).toEqual(lockedUntil);
  });

  it("reclaims a job whose holder crashed (lease expired)", async () => {
    await seedRow({ lockedUntil: new Date(NOW.getTime() - minutes(1)) });

    expect(await tick(NOW)).toEqual(["test-job"]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await row()).lockedUntil).toBeNull();
  });

  it("holds the lease for five minutes while the handler runs", async () => {
    await seedRow();
    let observed: Date | null = null;
    handler.mockImplementation(async () => {
      observed = (await row()).lockedUntil;
      return {};
    });

    await tick(NOW);

    expect(observed).toEqual(new Date(NOW.getTime() + minutes(5)));
  });

  it("skips disabled jobs and jobs that are not due yet", async () => {
    await seedRow({ enabled: false });
    await prisma.scheduledJob.create({
      data: { name: "later-job", intervalMinutes: 5, nextRunAt: new Date(NOW.getTime() + minutes(1)) },
    });
    JOBS.push(fakeJob({ name: "later-job" }));

    expect(await tick(NOW)).toEqual([]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores rows for jobs that no longer exist in code", async () => {
    await seedRow({ name: "deleted-job" });

    expect(await tick(NOW)).not.toContain("deleted-job");

    const orphan = await row("deleted-job");
    expect(orphan.lockedUntil).toBeNull();
    expect(orphan.lastRunAt).toBeNull();
  });
});

describe("tick bookkeeping", () => {
  it("schedules the next run from the row's interval and releases the lease on success", async () => {
    await seedRow({ intervalMinutes: 15, lockedUntil: null });

    await tick(NOW);

    const r = await row();
    expect(r).toMatchObject({ lastStatus: "Success", lastError: null, lockedUntil: null });
    expect(r.nextRunAt).toEqual(new Date(NOW.getTime() + minutes(15)));
    expect(r.lastRunAt).toEqual(NOW);
    expect(r.lastSuccessAt).toEqual(NOW);
    expect(r.lastDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("a second tick right after a success does not rerun the job", async () => {
    await seedRow();
    await tick(NOW);
    expect(await tick(new Date(NOW.getTime() + minutes(1)))).toEqual([]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await tick(new Date(NOW.getTime() + minutes(5)))).toEqual(["test-job"]);
  });

  it("records the error, advances nextRunAt and releases the lease when the handler throws", async () => {
    const previousSuccess = new Date("2026-07-14T00:00:00Z");
    await seedRow({ lastSuccessAt: previousSuccess });
    handler.mockRejectedValue(new Error("boom"));

    await tick(NOW);

    const r = await row();
    expect(r).toMatchObject({ lastStatus: "Error", lastError: "boom", lockedUntil: null });
    expect(r.nextRunAt).toEqual(new Date(NOW.getTime() + minutes(5)));
    expect(r.lastRunAt).toEqual(NOW);
    expect(r.lastSuccessAt).toEqual(previousSuccess);
  });

  it("truncates a very long error message", async () => {
    await seedRow();
    handler.mockRejectedValue(new Error("x".repeat(5000)));

    await tick(NOW);

    expect((await row()).lastError).toHaveLength(1000);
  });

  it("a later success clears the earlier error", async () => {
    await seedRow();
    handler.mockRejectedValueOnce(new Error("boom"));
    await tick(NOW);
    await tick(new Date(NOW.getTime() + minutes(5)));

    expect(await row()).toMatchObject({ lastStatus: "Success", lastError: null });
  });

  it("hands the handler the row's settings (resolved) and last success", async () => {
    const lastSuccessAt = new Date("2026-07-14T00:00:00Z");
    JOBS.splice(
      0,
      JOBS.length,
      fakeJob({
        settings: [
          { key: "leadMinutes", label: "Lead", unit: "min", min: 1, max: 120, default: 30 },
          { key: "batch", label: "Batch", unit: "n", min: 1, max: 100, default: 10 },
        ],
      }),
    );
    await seedRow({ lastSuccessAt, settings: { leadMinutes: 45, batch: 9999, bogus: 1 } });

    await tick(NOW);

    expect(handler).toHaveBeenCalledWith({
      now: NOW,
      lastSuccessAt,
      settings: { leadMinutes: 45, batch: 10 },
    });
  });
});

describe("registry seeding", () => {
  it("tick creates missing rows with the registry defaults, honouring enabledByDefault=false", async () => {
    JOBS.splice(
      0,
      JOBS.length,
      fakeJob({ name: "on-job", intervalMinutes: 7 }),
      fakeJob({ name: "off-job", intervalMinutes: 30, enabledByDefault: false }),
    );

    await tick(NOW);

    expect(await row("on-job")).toMatchObject({ enabled: true, intervalMinutes: 7 });
    expect(await row("off-job")).toMatchObject({ enabled: false, intervalMinutes: 30, lastRunAt: null });
  });

  it("tick never overwrites an operator-edited interval, settings, or enabled flag", async () => {
    JOBS.splice(0, JOBS.length, fakeJob({ intervalMinutes: 5, enabledByDefault: true }));
    await seedRow({
      intervalMinutes: 90,
      enabled: false,
      settings: { leadMinutes: 12 },
      nextRunAt: new Date(NOW.getTime() + minutes(60)),
    });

    await tick(NOW);

    expect(await row()).toMatchObject({ intervalMinutes: 90, enabled: false, settings: { leadMinutes: 12 } });
    expect(await prisma.scheduledJob.count()).toBe(1);
  });

  it("boot sync seeds missing jobs, prunes rows for deleted jobs and keeps operator edits", async () => {
    JOBS.splice(0, JOBS.length, fakeJob({ name: "kept", intervalMinutes: 5 }), fakeJob({ name: "new", intervalMinutes: 8 }));
    await seedRow({ name: "kept", intervalMinutes: 99, settings: { a: 1 } });
    await seedRow({ name: "removed-from-code" });

    startJobRunner();
    try {
      await vi.waitFor(async () => expect(await prisma.scheduledJob.count({ where: { name: "removed-from-code" } })).toBe(0));
    } finally {
      const g = global as unknown as { jobRunnerTimer?: NodeJS.Timeout };
      if (g.jobRunnerTimer) clearInterval(g.jobRunnerTimer);
      delete g.jobRunnerTimer;
    }

    expect((await prisma.scheduledJob.findMany({ orderBy: { name: "asc" } })).map((r) => r.name)).toEqual(["kept", "new"]);
    expect(await row("kept")).toMatchObject({ intervalMinutes: 99, settings: { a: 1 } });
    expect(await row("new")).toMatchObject({ intervalMinutes: 8 });
  });
});

describe("runJob (Run now)", () => {
  it("rejects an unknown job", async () => {
    expect(await runJob("nope")).toEqual({ ran: false, error: 'Unknown job "nope"' });
  });

  it("creates the row on a fresh database and runs it", async () => {
    // The row's default nextRunAt is DB-side now(), which is not after our `now` read earlier,
    // so force is the Run-now path for a never-seeded job.
    expect(await runJob("test-job", { force: true })).toEqual({ ran: true });
    expect(await row()).toMatchObject({ lastStatus: "Success", lockedUntil: null });
  });

  it("without force, does not run a disabled or not-due job", async () => {
    await seedRow({ enabled: false, nextRunAt: new Date(Date.now() - minutes(1)) });
    expect(await runJob("test-job")).toMatchObject({ ran: false });

    await prisma.scheduledJob.update({
      where: { name: "test-job" },
      data: { enabled: true, nextRunAt: new Date(Date.now() + minutes(10)) },
    });
    expect(await runJob("test-job")).toMatchObject({ ran: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it("force bypasses disabled and nextRunAt but not an unexpired lease", async () => {
    await seedRow({ enabled: false, nextRunAt: new Date(Date.now() + minutes(60)) });
    expect(await runJob("test-job", { force: true })).toEqual({ ran: true });
    expect(handler).toHaveBeenCalledTimes(1);

    await prisma.scheduledJob.update({
      where: { name: "test-job" },
      data: { lockedUntil: new Date(Date.now() + minutes(3)) },
    });
    const blocked = await runJob("test-job", { force: true });
    expect(blocked).toEqual({ ran: false, error: "Job is currently running or not due" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("two concurrent Run-nows run the handler once", async () => {
    await seedRow();
    handler.mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 150)));

    const results = await Promise.all([runJob("test-job", { force: true }), runJob("test-job", { force: true })]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
  });

  it("a Run-now cannot overlap an in-flight scheduled tick", async () => {
    await seedRow();
    let release!: () => void;
    handler.mockImplementation(() => new Promise((r) => (release = () => r({}))));

    const scheduled = tick(new Date());
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(await runJob("test-job", { force: true })).toMatchObject({ ran: false });
    release();
    await scheduled;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns the handler's error and records it", async () => {
    await seedRow();
    handler.mockRejectedValue(new Error("nope"));

    expect(await runJob("test-job", { force: true })).toEqual({ ran: true, error: "nope" });
    expect(await row()).toMatchObject({ lastStatus: "Error", lastError: "nope", lockedUntil: null });
  });
});
