// Shared, presentational infra formatters + tiny display bits. Client-safe (no
// server imports) so both the fleet console and the per-project view reuse them.
// Dollar figures are Neon estimates only (lib/infra/neon-cost.ts); Fly has no
// billing API, so Fly stays usage only.

import type { NeonBranchUsage, NeonCostSummary, UsageSeries } from "~/lib/infra/neon-scope";

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function metricLabel(metric: string): string {
  switch (metric) {
    case "compute_unit_seconds":
      return "Compute (CU·h)";
    case "root_branch_bytes_month":
      return "Root storage";
    case "child_branch_bytes_month":
      return "Branch storage";
    case "instant_restore_bytes_month":
      return "Restore history";
    case "snapshot_storage_bytes_month":
      return "Snapshots";
    case "public_network_transfer_bytes":
      return "Egress";
    case "private_network_transfer_bytes":
      return "Private egress";
    case "extra_branches_month":
      return "Branch hours";
    case "egress_bytes":
      return "Fly egress (24h)";
    case "machine_hours_24h":
      return "Fly machine hours (24h)";
    default:
      return metric;
  }
}

export function metricValue(metric: string, value: number): string {
  if (metric === "compute_unit_seconds") return `${(value / 3600).toFixed(1)} CU·h`;
  if (metric === "extra_branches_month" || metric === "machine_hours_24h") return `${value.toFixed(0)} h`;
  return fmtBytes(value);
}

export function volumeSummary(volumes: { sizeGb: number }[]): string {
  const gb = volumes.reduce((a, v) => a + v.sizeGb, 0);
  return `${volumes.length} volumes${volumes.length ? ` (${gb} GB)` : ""}`;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

const PLAN_LABEL: Record<string, string> = { free: "Free", launch: "Launch", scale: "Scale" };

export function planLabel(plan: string): string {
  return PLAN_LABEL[plan] ?? plan;
}

export function NeonCostLine({ plan, cost }: { plan: string | null; cost: NeonCostSummary | null }) {
  if (!plan) return null;
  return (
    <span className="text-xs text-muted-foreground" title="Estimated from Neon usage and published rates. The invoice is authoritative.">
      Neon {planLabel(plan)} plan
      {cost && (
        <>
          {" · "}
          <span className="font-medium text-foreground">Est. {fmtUsd(cost.thisMonth)} this month</span>
          {cost.lastMonth != null && ` · last month est. ${fmtUsd(cost.lastMonth)}`}
        </>
      )}
    </span>
  );
}

export function NeonBranchUsageTable({ rows }: { rows: NeonBranchUsage[] }) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="px-3 py-1 font-medium">Branch (this month)</th>
          <th className="px-3 py-1 font-medium">Compute</th>
          <th className="px-3 py-1 font-medium">Storage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.branchId} className="border-t border-border">
            <td className="px-3 py-1.5 font-mono text-foreground">
              {b.name}
              {b.preview && (
                <span className="ml-1.5 rounded-full bg-os-amber/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-os-amber">
                  preview
                </span>
              )}
            </td>
            <td className="px-3 py-1.5 text-muted-foreground">{metricValue("compute_unit_seconds", b.computeSeconds)}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{fmtBytes(b.storageByteMonths)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Sparkline({ points }: { points: { at: string; value: number }[] }) {
  if (points.length < 2) return <span className="text-[11px] text-muted-foreground">—</span>;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 80;
  const h = 20;
  const step = w / (points.length - 1);
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p.value - min) / range) * h).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} className="text-os-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function StateBadge({ state }: { state: string }) {
  const good = state === "started" || state === "active";
  const idle = state === "idle" || state === "stopped" || state === "suspended";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        good
          ? "bg-os-green/15 text-os-green"
          : idle
            ? "bg-muted text-muted-foreground"
            : "bg-os-amber/15 text-os-amber"
      }`}
    >
      {state}
    </span>
  );
}

export function UsageStrip({ usage }: { usage: UsageSeries[] }) {
  if (usage.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No usage samples yet.</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-4">
      {usage.map((u) => {
        return (
          <div key={u.metric} className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {metricLabel(u.metric)}
            </span>
            <div className="flex items-center gap-2">
              <Sparkline points={u.points} />
              <span className="text-xs font-medium text-foreground">
                {u.current != null ? metricValue(u.metric, u.current) : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
