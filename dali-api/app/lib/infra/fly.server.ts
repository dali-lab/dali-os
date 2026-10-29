// Fly.io Machines REST API adapter (https://api.machines.dev/v1) — reads + write
// actions. Org enumeration is avoided entirely: we list apps per registered org
// slug, so the unstable GraphQL API is never used. Auth: `Authorization: Bearer
// <token>` with org-scoped tokens passed in by callers (decrypted from
// InfraProject). Never reads tokens from env; never logs them.

import type { FlyApp, FlyInventory, FlyMachine, FlyVolume } from "./types";

const FLY_API = "https://api.machines.dev/v1";
const FLY_PROM = "https://api.fly.io/prometheus";

export class FlyApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FlyApiError";
    this.status = status;
  }
}

async function flyFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${FLY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FlyApiError(res.status, `Fly API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ── Reads ────────────────────────────────────────────────────────────────────

type RawMachine = {
  id?: string;
  name?: string;
  state?: string;
  region?: string;
  created_at?: string;
  config?: { guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number } };
};

function normalizeMachine(appName: string, m: RawMachine): FlyMachine {
  const g = m.config?.guest ?? {};
  return {
    id: m.id ?? "",
    name: m.name ?? "",
    appName,
    state: m.state ?? "unknown",
    region: m.region ?? "",
    cpuKind: g.cpu_kind ?? "",
    cpus: g.cpus ?? 0,
    memoryMb: g.memory_mb ?? 0,
    createdAt: m.created_at ?? null,
  };
}

export async function listMachines(token: string, appName: string): Promise<FlyMachine[]> {
  const raw = (await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/machines`,
  )) as RawMachine[] | null;
  return (raw ?? []).map((m) => normalizeMachine(appName, m));
}

type RawVolume = {
  id?: string;
  name?: string;
  region?: string;
  size_gb?: number;
  state?: string;
  attached_machine_id?: string | null;
};

export async function listVolumes(token: string, appName: string): Promise<FlyVolume[]> {
  const raw = (await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/volumes`,
  )) as RawVolume[] | null;
  return (raw ?? []).map((v) => ({
    id: v.id ?? "",
    name: v.name ?? "",
    appName,
    region: v.region ?? "",
    sizeGb: v.size_gb ?? 0,
    state: v.state ?? "",
    attachedMachineId: v.attached_machine_id ?? null,
  }));
}

type RawApp = { id?: string; name?: string; status?: string; machine_count?: number };

export async function listApps(token: string, orgSlug: string): Promise<RawApp[]> {
  const res = (await flyFetch(
    token,
    `/apps?org_slug=${encodeURIComponent(orgSlug)}`,
  )) as { apps?: RawApp[] } | null;
  return res?.apps ?? [];
}

// Full read sweep for one org: apps + their machines + volumes. Per-app failures
// degrade to empty lists so one broken app doesn't blank the whole fleet.
export async function getFlyInventory(token: string, orgSlug: string): Promise<FlyInventory> {
  const apps = await listApps(token, orgSlug);
  const detailed: FlyApp[] = [];
  for (const a of apps) {
    const name = a.name ?? "";
    if (!name) continue;
    const [machines, volumes] = await Promise.all([
      listMachines(token, name).catch(() => [] as FlyMachine[]),
      listVolumes(token, name).catch(() => [] as FlyVolume[]),
    ]);
    detailed.push({
      id: a.id ?? name,
      name,
      status: a.status ?? null,
      machineCount: a.machine_count ?? machines.length,
      machines,
      volumes,
    });
  }
  return { orgSlug, apps: detailed };
}

// Best-effort resource-usage read from Fly's Prometheus endpoint: per-app
// egress bytes over the last 24h. Callers swallow failures — usage sparklines
// degrade gracefully when Prometheus is unavailable or the token lacks access.
export async function getFlyEgressByApp(
  token: string,
  orgSlug: string,
): Promise<{ appName: string; egressBytes: number }[]> {
  const rows = await flyPromByApp(token, orgSlug, `sum by (app) (increase(fly_edge_data_out[24h]))`);
  return rows.map((r) => ({ appName: r.appName, egressBytes: r.value }));
}

// Prometheus rejects `Bearer` with a 401 and only accepts the `FlyV1` scheme,
// which `fly tokens create` prints as part of the token.
export function flyPromAuth(token: string): string {
  return `FlyV1 ${token.trim().replace(/^(FlyV1|Bearer)\s+/i, "")}`;
}

type PromVector = { data?: { result?: { metric?: { app?: string }; value?: [number, string] }[] } };

async function flyPromByApp(
  token: string,
  orgSlug: string,
  query: string,
  time?: Date,
): Promise<{ appName: string; value: number }[]> {
  const url =
    `${FLY_PROM}/${encodeURIComponent(orgSlug)}/api/v1/query?query=${encodeURIComponent(query)}` +
    (time ? `&time=${Math.floor(time.getTime() / 1000)}` : "");
  const res = await fetch(url, { headers: { Authorization: flyPromAuth(token) } });
  if (!res.ok) throw new FlyApiError(res.status, `Fly Prometheus ${res.status}`);
  const json = (await res.json()) as PromVector;
  return (json.data?.result ?? [])
    .map((r) => ({ appName: r.metric?.app ?? "", value: Number(r.value?.[1] ?? 0) }))
    .filter((r) => r.appName);
}

// Started-machine hours per app over the last 24h, which is what Fly bills by
// the second. fly_instance_up only exists while a machine runs, so counting
// one-minute steps where it reads 1 gives minutes running.
export async function getFlyMachineHoursByApp(
  token: string,
  orgSlug: string,
): Promise<{ appName: string; machineHours: number }[]> {
  const rows = await flyPromByApp(token, orgSlug, `sum by (app) (sum_over_time((fly_instance_up == bool 1)[24h:1m])) / 60`);
  return rows.map((r) => ({ appName: r.appName, machineHours: r.value }));
}

// Per-app totals for one UTC day, or the part of today so far. Fly keeps about
// 12 days of metrics, so the sweep stores these to keep a longer history.
export const FLY_DAILY_QUERIES = {
  requests: (w: string) => `sum by (app) (increase(fly_edge_http_responses_count[${w}]))`,
  errors_5xx: (w: string) => `sum by (app) (increase(fly_edge_http_responses_count{status=~"5.."}[${w}]))`,
  p95_ms: (w: string) =>
    `histogram_quantile(0.95, sum by (app, le) (rate(fly_app_http_response_time_seconds_bucket[${w}]))) * 1000`,
  memory_peak_bytes: (w: string) =>
    `max by (app) (max_over_time((fly_instance_memory_mem_total - fly_instance_memory_mem_available)[${w}:5m]))`,
} as const;

export type FlyDailyMetric = keyof typeof FLY_DAILY_QUERIES;
const COUNTED: FlyDailyMetric[] = ["requests", "errors_5xx"];

export async function getFlyDayByApp(
  token: string,
  orgSlug: string,
  dayStart: Date,
  now: Date,
): Promise<{ appName: string; metric: FlyDailyMetric; value: number }[]> {
  const end = new Date(Math.min(dayStart.getTime() + 86_400_000, now.getTime()));
  const seconds = Math.floor((end.getTime() - dayStart.getTime()) / 1000);
  if (seconds <= 0) return [];
  const metrics = Object.keys(FLY_DAILY_QUERIES) as FlyDailyMetric[];
  const results = await Promise.all(
    metrics.map((metric) => flyPromByApp(token, orgSlug, FLY_DAILY_QUERIES[metric](`${seconds}s`), end)),
  );
  return results.flatMap((rows, i) =>
    rows
      // A quantile over no requests comes back NaN.
      .filter((r) => Number.isFinite(r.value))
      .map((r) => ({
        appName: r.appName,
        metric: metrics[i],
        value: COUNTED.includes(metrics[i]) ? Math.round(r.value) : r.value,
      })),
  );
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type FlyMachineActionKind = "start" | "stop" | "restart" | "suspend";

export async function machineAction(
  token: string,
  appName: string,
  machineId: string,
  kind: FlyMachineActionKind,
): Promise<void> {
  await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/${kind}`,
    { method: "POST" },
  );
}

// Vertical scale: replace the machine's guest sizing. Fly reboots the machine
// into the new size (id preserved). The Machines update is a full config
// replace, so we read the current config and overlay only `guest`.
export async function scaleMachine(
  token: string,
  appName: string,
  machineId: string,
  guest: { cpu_kind: string; cpus: number; memory_mb: number },
): Promise<void> {
  const current = (await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
  )) as { config?: Record<string, unknown> } | null;
  const config = { ...(current?.config ?? {}), guest };
  await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
    { method: "POST", body: JSON.stringify({ config }) },
  );
}

export async function destroyMachine(
  token: string,
  appName: string,
  machineId: string,
): Promise<void> {
  await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
    { method: "DELETE" },
  );
}

export async function destroyVolume(
  token: string,
  appName: string,
  volumeId: string,
): Promise<void> {
  await flyFetch(
    token,
    `/apps/${encodeURIComponent(appName)}/volumes/${encodeURIComponent(volumeId)}`,
    { method: "DELETE" },
  );
}

// An empty app (no machines): the team deploys into it with flyctl or CI.
// Names are global across Fly, so a taken name comes back as an API error.
export async function createApp(token: string, orgSlug: string, appName: string): Promise<void> {
  await flyFetch(token, `/apps`, {
    method: "POST",
    body: JSON.stringify({ app_name: appName, org_slug: orgSlug }),
  });
}

export async function destroyApp(token: string, appName: string): Promise<void> {
  await flyFetch(token, `/apps/${encodeURIComponent(appName)}?force=true`, { method: "DELETE" });
}
