// Background job runner: an in-process 60s tick started at module load from
// entry.server.tsx (same pattern as the Hocuspocus collab server). Prod runs
// two always-on machines, so BOTH tick — a job is executed once because each
// tick claims it with an atomic CAS UPDATE on its ScheduledJob row (the
// loser's updateMany matches 0 rows). No advisory locks (pooled connections
// make session locks unsafe) and no transaction is held across handler I/O;
// a machine dying mid-handler leaves lockedUntil set, and lease expiry is
// the recovery. Handlers are idempotent (per-consumer marker tables), so a
// crash-rerun at worst re-sends the un-marked remainder.
//
// Dev/staging machines auto-stop at zero traffic, pausing ticks — acceptable:
// those DBs are wiped/restored on every deploy anyway.

import { prisma } from "~/lib/db";
import {
  JOBS,
  jobByName,
  resolveJobSettings,
  type JobDefinition,
} from "~/jobs/registry";

const TICK_MS = 60_000;
// Handler budget: a claim older than this is considered crashed and up for
// grabs. Generous vs. the per-tick work caps (~200 items).
const LEASE_MS = 5 * 60_000;
const MAX_ERROR_LEN = 1_000;

const globalForJobs = global as unknown as { jobRunnerTimer?: NodeJS.Timeout };

export function startJobRunner(): void {
  if (globalForJobs.jobRunnerTimer) return;
  if (JOBS.length === 0) return;

  // Boot-time registry sync outside the tick: ensure a row per job and prune
  // rows for jobs deleted from code. Never overwrites intervalMinutes or
  // settings — those are operator-editable, the registry only seeds them.
  // Fire-and-forget — a cold DB must not break boot.
  void syncJobRegistry().catch((err) =>
    console.error("[jobs] registry sync failed:", err),
  );

  const timer = setInterval(() => {
    void tick().catch((err) => console.error("[jobs] tick failed:", err));
  }, TICK_MS);
  timer.unref();
  globalForJobs.jobRunnerTimer = timer;
  console.log(`[jobs] runner started (${JOBS.length} job(s), ${TICK_MS / 1000}s tick)`);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (globalForJobs.jobRunnerTimer) {
      clearInterval(globalForJobs.jobRunnerTimer);
      delete globalForJobs.jobRunnerTimer;
    }
  });
}

async function syncJobRegistry(): Promise<void> {
  await prisma.scheduledJob.createMany({
    data: JOBS.map((j) => ({
      name: j.name,
      intervalMinutes: j.intervalMinutes,
      // Only seed enabled=false when the registry explicitly opts out; all
      // existing jobs omit enabledByDefault and get the DB default (true).
      ...(j.enabledByDefault === false ? { enabled: false } : {}),
    })),
    skipDuplicates: true,
  });
  await prisma.scheduledJob.deleteMany({
    where: { name: { notIn: JOBS.map((j) => j.name) } },
  });
}

export async function tick(now: Date = new Date()): Promise<string[]> {
  // Self-heal against a mid-run dev DB wipe: existence only; full sync
  // (interval refresh + prune) happens at boot.
  await prisma.scheduledJob.createMany({
    data: JOBS.map((j) => ({
      name: j.name,
      intervalMinutes: j.intervalMinutes,
      ...(j.enabledByDefault === false ? { enabled: false } : {}),
    })),
    skipDuplicates: true,
  });

  const due = await prisma.scheduledJob.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
  });

  const ran: string[] = [];
  // Sequential on purpose: ~a dozen scans; keeps DB/Gmail/Slack pressure flat.
  for (const row of due) {
    const def = jobByName(row.name);
    if (!def) continue; // row for a deleted job; boot-time prune removes it

    const claimed = await prisma.scheduledJob.updateMany({
      where: {
        name: row.name,
        enabled: true,
        nextRunAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) continue; // another machine won the race

    await executeClaimed(def, row, now);
    ran.push(row.name);
  }
  return ran;
}

// Admin "Run now": bypasses nextRunAt but NOT the lease, so a manual run
// can't overlap an in-flight scheduled run.
export async function runJob(
  name: string,
  opts: { force?: boolean } = {},
): Promise<{ ran: boolean; error?: string }> {
  const def = jobByName(name);
  if (!def) return { ran: false, error: `Unknown job "${name}"` };
  const now = new Date();

  // Ensure the row exists (fresh DB) before claiming.
  await prisma.scheduledJob.createMany({
    data: [{ name: def.name, intervalMinutes: def.intervalMinutes }],
    skipDuplicates: true,
  });
  const row = await prisma.scheduledJob.findUnique({ where: { name } });
  if (!row) return { ran: false, error: "Job row missing" };

  const claimed = await prisma.scheduledJob.updateMany({
    where: {
      name,
      ...(opts.force ? {} : { enabled: true, nextRunAt: { lte: now } }),
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) {
    return { ran: false, error: "Job is currently running or not due" };
  }

  const error = await executeClaimed(def, row, now);
  return error ? { ran: true, error } : { ran: true };
}

type ClaimedRow = {
  intervalMinutes: number;
  settings: unknown;
  lastSuccessAt: Date | null;
};

// Runs a claimed job and writes back its bookkeeping. Cadence and settings
// come from the ROW (operator-editable), not the registry defaults.
// nextRunAt advances on error too — a persistently failing job retries at
// its normal cadence, not in a hot loop. Returns the error message, if any.
async function executeClaimed(
  def: JobDefinition,
  row: ClaimedRow,
  now: Date,
): Promise<string | null> {
  const started = Date.now();
  const nextRunAt = new Date(now.getTime() + row.intervalMinutes * 60_000);
  try {
    const result = await def.handler({
      now,
      lastSuccessAt: row.lastSuccessAt,
      settings: resolveJobSettings(def, row.settings),
    });
    const lastDurationMs = Date.now() - started;
    console.log(
      `[jobs] ${def.name} ok items=${result.items ?? 0} dur=${lastDurationMs}ms` +
        (result.note ? ` note=${result.note}` : ""),
    );
    await prisma.scheduledJob.update({
      where: { name: def.name },
      data: {
        lastRunAt: now,
        lastSuccessAt: now,
        lastStatus: "Success",
        lastError: null,
        lastDurationMs,
        nextRunAt,
        lockedUntil: null,
      },
    });
    return null;
  } catch (err) {
    const lastDurationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${def.name} failed after ${lastDurationMs}ms:`, err);
    await prisma.scheduledJob
      .update({
        where: { name: def.name },
        data: {
          lastRunAt: now,
          lastStatus: "Error",
          lastError: message.slice(0, MAX_ERROR_LEN),
          lastDurationMs,
          nextRunAt,
          lockedUntil: null,
        },
      })
      .catch((writeErr) =>
        console.error(`[jobs] ${def.name} bookkeeping write failed:`, writeErr),
      );
    return message;
  }
}
