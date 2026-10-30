import { useState } from "react";
import { Figure } from "~/admin/components/console-ui";
import { ChartRangeControls, useChartRange } from "~/components/analytics/ChartRange";
import { dayKeys } from "~/components/analytics/chart-range";
import { TimeSeriesChart, type ChartSeries } from "~/components/analytics/TimeSeriesChart";
import { Segmented } from "~/components/ui/Segmented";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import { fmtBytes, fmtUsd, metricValue, planLabel } from "./format";

type ChartMetric = "compute" | "transfer";

const METRICS: Record<ChartMetric, { label: string; series: ChartSeries; format: (n: number) => string; decimals: boolean }> = {
  compute: {
    label: "Compute",
    series: { key: "value", name: "Compute (CU·h)", color: "var(--color-os-accent)" },
    format: (n) => (Number.isInteger(n) || n >= 10 ? n.toFixed(0) : n.toFixed(1)),
    decimals: true,
  },
  transfer: {
    label: "Data out",
    series: { key: "value", name: "Data out", color: "var(--color-os-accent)" },
    format: fmtBytes,
    decimals: false,
  },
};

/** The project hub's Neon usage: month figures over a daily chart with ranges and drag to zoom. */
export function NeonUsageChart({ project: p, today }: { project: ProjectFleet; today?: string }) {
  const range = useChartRange(today);
  const [metric, setMetric] = useState<ChartMetric>("compute");

  const byDay = new Map(p.neonDaily.map((r) => [r.day, r]));
  const rows = dayKeys(range.from, range.to).map((day) => {
    const r = byDay.get(day);
    return { day, value: !r ? null : metric === "compute" ? r.compute_unit_seconds / 3600 : r.public_network_transfer_bytes };
  });
  const monthToDate = (m: string) => p.usage.find((u) => u.metric === m)?.current ?? 0;
  const m = METRICS[metric];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        {p.neonCost && (
          <Figure
            label="Est. Neon cost this month"
            value={fmtUsd(p.neonCost.thisMonth)}
            detail={[
              p.neonPlan && `${planLabel(p.neonPlan)} plan`,
              p.neonCost.lastMonth != null && `Last month est. ${fmtUsd(p.neonCost.lastMonth)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
        <Figure label="Compute this month" value={metricValue("compute_unit_seconds", monthToDate("compute_unit_seconds"))} />
        <Figure label="Data out this month" value={fmtBytes(monthToDate("public_network_transfer_bytes"))} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<ChartMetric>
          ariaLabel="Chart metric"
          value={metric}
          onChange={setMetric}
          options={(Object.keys(METRICS) as ChartMetric[]).map((k) => ({ value: k, label: METRICS[k].label }))}
        />
        <ChartRangeControls range={range} />
      </div>

      <TimeSeriesChart
        data={rows}
        series={[m.series]}
        formatValue={m.format}
        allowDecimals={m.decimals}
        onSelectRange={range.setZoom}
        className="h-56"
      />
      <p className="text-xs text-os-muted">
        Per day across this project's databases. Drag across the chart to zoom in.
      </p>
    </div>
  );
}
