import { useState } from "react";
import { Figure } from "~/admin/components/console-ui";
import { ChartRangeControls, useChartRange } from "~/components/analytics/ChartRange";
import { dayKeys, shortDay } from "~/components/analytics/chart-range";
import { TimeSeriesChart } from "~/components/analytics/TimeSeriesChart";
import { Select } from "~/components/ui/floating";
import { Segmented } from "~/components/ui/Segmented";
import { flyDayTotals, type FlyDayTotals } from "~/lib/infra/infra-scope";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import { fmtBytes } from "./format";

type ChartMetric = "requests" | "errors_5xx" | "p95_ms" | "memory_peak_bytes";

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function fmtRate(rate: number): string {
  if (rate > 0 && rate < 0.0001) return "Under 0.01%";
  return `${(rate * 100).toFixed(2)}%`;
}

const fmtCount = (n: number) => Math.round(n).toLocaleString();

const METRICS: Record<ChartMetric, { label: string; name: string; color: string; format: (n: number) => string }> = {
  requests: { label: "Requests", name: "Requests", color: "var(--color-os-accent)", format: fmtCount },
  errors_5xx: { label: "Errors", name: "Server errors (5xx)", color: "var(--color-os-amber)", format: fmtCount },
  p95_ms: { label: "Response time", name: "Response time (p95)", color: "var(--color-os-accent)", format: fmtMs },
  memory_peak_bytes: { label: "Memory", name: "Peak memory", color: "var(--color-os-accent)", format: fmtBytes },
};

const ALL = "__all__";

export type FlyRangeSummary = {
  requests: number;
  errors: number;
  errorRate: number | null;
  slowestP95: number | null;
  peakMemory: number | null;
};

export function summarizeFlyDays(days: FlyDayTotals[]): FlyRangeSummary {
  const requests = days.reduce((a, d) => a + d.requests, 0);
  const errors = days.reduce((a, d) => a + d.errors_5xx, 0);
  const max = (vals: (number | null)[]) => {
    const real = vals.filter((v): v is number => v != null);
    return real.length ? Math.max(...real) : null;
  };
  return {
    requests,
    errors,
    errorRate: requests > 0 ? errors / requests : null,
    slowestP95: max(days.map((d) => d.p95_ms)),
    peakMemory: max(days.map((d) => d.memory_peak_bytes)),
  };
}

/** The project hub's Fly traffic: range figures over a daily chart, per app or all apps. */
export function FlyUsageChart({ project: p, today }: { project: ProjectFleet; today?: string }) {
  const range = useChartRange(today);
  const [metric, setMetric] = useState<ChartMetric>("requests");
  const apps = [...new Set(p.flyDaily.map((r) => r.app))].sort();
  const [app, setApp] = useState<string>(apps.length === 1 ? apps[0] : ALL);

  const totals = flyDayTotals(p.flyDaily, app === ALL ? null : app);
  const inRange = totals.filter((d) => d.day >= range.from && d.day <= range.to);
  const summary = summarizeFlyDays(inRange);
  const byDay = new Map(totals.map((d) => [d.day, d]));
  const rows = dayKeys(range.from, range.to).map((day) => ({ day, value: byDay.get(day)?.[metric] ?? null }));
  const firstDay = totals[0]?.day;
  const m = METRICS[metric];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Figure label="Requests" value={fmtCount(summary.requests)} />
        <Figure
          label="Server errors"
          value={<span className={summary.errors > 0 ? "text-os-amber" : "text-os-green"}>{fmtCount(summary.errors)}</span>}
          detail={summary.errorRate != null ? `${fmtRate(summary.errorRate)} of requests` : undefined}
        />
        <Figure
          label="Slowest day (p95)"
          value={summary.slowestP95 != null ? fmtMs(summary.slowestP95) : "No traffic"}
        />
        <Figure label="Peak memory" value={summary.peakMemory != null ? fmtBytes(summary.peakMemory) : "No data"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ChartMetric>
            ariaLabel="Chart metric"
            value={metric}
            onChange={setMetric}
            options={(Object.keys(METRICS) as ChartMetric[]).map((k) => ({ value: k, label: METRICS[k].label }))}
          />
          {apps.length > 1 && (
            <Select
              ariaLabel="Fly app"
              value={app}
              onChange={setApp}
              options={[{ value: ALL, label: "All apps" }, ...apps.map((a) => ({ value: a, label: a }))]}
            />
          )}
        </div>
        <ChartRangeControls range={range} />
      </div>

      <TimeSeriesChart
        data={rows}
        series={[{ key: "value", name: m.name, color: m.color }]}
        formatValue={m.format}
        onSelectRange={range.setZoom}
        className="h-56"
      />
      <p className="text-xs text-os-muted">
        Per day{app === ALL && apps.length > 1 ? " across this project's apps" : ""}.
        {firstDay && firstDay > range.from && ` History starts ${shortDay(firstDay)}.`} Drag across the chart to zoom in.
      </p>
    </div>
  );
}
