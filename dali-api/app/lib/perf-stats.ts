const REPORT_INTERVAL_MS = 60_000;
const MAX_SAMPLES = 5_000;

const durations = new Map<string, number[]>();
const cacheReads = new Map<string, { hits: number; misses: number }>();

export function recordDuration(name: string, ms: number): void {
  const samples = durations.get(name);
  if (!samples) durations.set(name, [ms]);
  else if (samples.length < MAX_SAMPLES) samples.push(ms);
}

export async function sampleDuration<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    recordDuration(name, performance.now() - start);
  }
}

/** Keys group by their first two segments, so a per-user key such as
 *  `layout:roles:<userId>:` counts under `layout:roles`. */
export function recordCacheRead(key: string, hit: boolean): void {
  const family = key.split(":").slice(0, 2).join(":");
  const counts = cacheReads.get(family) ?? { hits: 0, misses: 0 };
  if (hit) counts.hits += 1;
  else counts.misses += 1;
  cacheReads.set(family, counts);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Log and clear everything recorded since the last report. */
export function reportPerfStats(log: (line: string) => void = console.log): void {
  for (const [name, samples] of durations) {
    const sorted = [...samples].sort((a, b) => a - b);
    log(
      `[perf-stats] ${name} n=${sorted.length} p50=${Math.round(percentile(sorted, 0.5))}ms ` +
        `p95=${Math.round(percentile(sorted, 0.95))}ms max=${Math.round(sorted[sorted.length - 1])}ms`,
    );
  }
  for (const [family, { hits, misses }] of cacheReads) {
    const rate = Math.round((hits / (hits + misses)) * 100);
    log(`[cache-stats] ${family} hit=${hits} miss=${misses} rate=${rate}%`);
  }
  durations.clear();
  cacheReads.clear();
}

// `[perf-total]` and `[perf-phase]` only log slow requests, so they can't show
// a typical request or how often a cache saves one.
export function watchPerfStats(): void {
  setInterval(() => reportPerfStats(), REPORT_INTERVAL_MS).unref();
}
