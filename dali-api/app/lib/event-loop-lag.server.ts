import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

const SLOW_LAG_MS = 100;
const LAG_REPORT_INTERVAL_MS = 30_000;
const NS_PER_MS = 1_000_000;

// A blocked loop delays every request on the machine while CPU averages stay
// low and the pg pool reports idle, so neither of those can show it.
export function watchEventLoopLag({
  histogram = monitorEventLoopDelay({ resolution: 20 }) as IntervalHistogram,
  log = console.log,
} = {}): () => void {
  histogram.enable();
  const report = () => {
    const maxMs = histogram.max / NS_PER_MS;
    if (maxMs >= SLOW_LAG_MS) {
      log(`[event-loop] maxLag=${Math.round(maxMs)}ms p99=${Math.round(histogram.percentile(99) / NS_PER_MS)}ms`);
    }
    histogram.reset();
  };
  const timer = setInterval(report, LAG_REPORT_INTERVAL_MS);
  timer.unref();
  return report;
}
