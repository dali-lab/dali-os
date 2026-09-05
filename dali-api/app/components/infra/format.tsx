// Shared, presentational infra formatters + tiny display bits. Client-safe (no
// server imports) so both the fleet console and the per-project view reuse them.
// No dollar figures anywhere — usage only.

import type { UsageSeries } from "~/lib/infra/dashboard.server";

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
    case "public_network_transfer_bytes":
      return "Egress";
    case "egress_bytes":
      return "Fly egress (24h)";
    default:
      return metric;
  }
}

export function metricValue(metric: string, value: number): string {
  if (metric === "compute_unit_seconds") return `${(value / 3600).toFixed(1)} CU·h`;
  return fmtBytes(value);
}

export function Sparkline({ points }: { points: { at: string; value: number }[] }) {
  if (points.length < 2) return <span className="text-[11px] text-zinc-400">—</span>;
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
    <svg width={w} height={h} className="text-accent-coral">
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
          ? "bg-green-100 text-green-800"
          : idle
            ? "bg-zinc-200 text-zinc-600"
            : "bg-amber-100 text-amber-800"
      }`}
    >
      {state}
    </span>
  );
}

export function UsageStrip({ usage }: { usage: UsageSeries[] }) {
  if (usage.length === 0) {
    return (
      <p className="text-xs text-zinc-400">
        No usage samples yet (needs a completed sweep on a paid Neon plan / Prometheus access).
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-4">
      {usage.map((u) => {
        const latest = u.points[u.points.length - 1];
        return (
          <div key={u.metric} className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-zinc-400">
              {metricLabel(u.metric)}
            </span>
            <div className="flex items-center gap-2">
              <Sparkline points={u.points} />
              <span className="text-xs font-medium text-zinc-700">
                {latest ? metricValue(u.metric, latest.value) : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
