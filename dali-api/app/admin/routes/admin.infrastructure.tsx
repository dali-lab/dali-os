// Admin → System → Infrastructure. A cross-project Fly.io + Neon console:
// per-project inventory + usage (no dollars — usage only, links out for
// billing), plus scale / limit / provision / cleanup actions. Reads and safe
// reversible actions are Core; provisioning, quotas, and destructive actions are
// Admin. The page renders from cached snapshots (the infra-snapshot job sweeps);
// "Refresh" re-runs the sweep. Behind the `infra-dashboard` flag.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Server, Database, AlertTriangle, ExternalLink, ChevronRight, ChevronDown } from "lucide-react";
import type { Route } from "./+types/admin.infrastructure";
import { adminHandle } from "~/admin/adminNav";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadFleet, buildCleanup } from "~/lib/infra/dashboard.server";
import type { ProjectFleet, CleanupCandidate, UsageSeries } from "~/lib/infra/dashboard.server";
import type { FlyApp, FlyMachine, NeonProject, NeonEndpoint } from "~/lib/infra/types";
import { infraCryptoConfigured } from "~/lib/infra/crypto.server";
import { neonConfigured } from "~/lib/infra/neon.server";
import { useDialog } from "~/components/ui/dialog";
import { buttonClasses } from "~/components/ui/Button";

export const handle = adminHandle("infrastructure");

export const meta: Route.MetaFunction = () => [{ title: "Infrastructure · Admin · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) return redirect("/");
  if (!(await isFeatureEnabled("infra-dashboard", auth.user.sub, roles, request))) {
    return redirect("/admin");
  }

  const { projects, lastSweep, protectedFly, protectedNeon } = await loadFleet();
  const cleanup = buildCleanup(projects);

  return {
    isAdmin: roles.isAdmin,
    cryptoConfigured: infraCryptoConfigured(),
    neonConfigured: neonConfigured(),
    lastSweep,
    protectedFly,
    protectedNeon,
    projects,
    cleanup,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
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

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

function timeAgo(iso: string | null): string {
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

function metricLabel(metric: string): string {
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

function metricValue(metric: string, value: number): string {
  if (metric === "compute_unit_seconds") return `${(value / 3600).toFixed(1)} CU·h`;
  return fmtBytes(value);
}

function Sparkline({ points }: { points: { at: string; value: number }[] }) {
  if (points.length < 2) return <span className="text-[11px] text-zinc-400">—</span>;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 80;
  const h = 20;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p.value - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="text-accent-coral">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

// ── Action plumbing ───────────────────────────────────────────────────────────

type ActionResult = { ok?: boolean; error?: string; projectId?: string };

type InfraApi = {
  post: (body: Record<string, unknown>, endpoint?: string) => void;
  busy: boolean;
  error: string | null;
};

function useInfra(): InfraApi {
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);
  return {
    post: (body, endpoint = "/api/infra/action") =>
      fetcher.submit(body as unknown as Parameters<typeof fetcher.submit>[0], {
        method: "POST",
        action: endpoint,
        encType: "application/json",
      }),
    busy: fetcher.state !== "idle",
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminInfrastructure() {
  const data = useLoaderData<typeof loader>();
  const infra = useInfra();
  const [tab, setTab] = useState<"overview" | "registry" | "cleanup">("overview");

  const tabs: { key: typeof tab; label: string; adminOnly?: boolean }[] = [
    { key: "overview", label: "Overview" },
    { key: "cleanup", label: `Cleanup${data.cleanup.length ? ` (${data.cleanup.length})` : ""}` },
    { key: "registry", label: "Projects", adminOnly: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Infrastructure</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Fly.io + Neon across every lab project, in one place. Figures are usage, not
            dollars — neither provider exposes spend via API; use the billing links for cost.
            Data is cached; Refresh re-sweeps.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>Last sweep: {timeAgo(data.lastSweep)}</span>
          <button
            type="button"
            disabled={infra.busy}
            onClick={() => infra.post({ intent: "refresh" }, "/api/infra/registry")}
            className={buttonClasses("secondary", "sm")}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${infra.busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {infra.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{infra.error}</span>
        </div>
      )}

      <ConfigWarnings data={data} />

      <div className="flex gap-1 border-b border-zinc-200">
        {tabs
          .filter((t) => !t.adminOnly || data.isAdmin)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key
                  ? "border-accent-coral text-foreground"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === "overview" && <Overview data={data} infra={infra} />}
      {tab === "cleanup" && <Cleanup data={data} infra={infra} />}
      {tab === "registry" && data.isAdmin && <Registry data={data} infra={infra} />}
    </div>
  );
}

type Data = Route.ComponentProps["loaderData"];

function ConfigWarnings({ data }: { data: Data }) {
  const warnings: string[] = [];
  if (!data.cryptoConfigured)
    warnings.push("INFRA_SECRET_KEY is not set — Fly tokens can't be stored, so Fly actions are unavailable.");
  if (!data.neonConfigured)
    warnings.push("INFRA_NEON_API_KEY is not set — Neon inventory, usage, and actions are unavailable.");
  if (data.projects.length === 0)
    warnings.push("No projects registered yet. Add one under Projects to start sweeping.");
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <ul className="list-inside list-disc space-y-0.5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ data, infra }: { data: Data; infra: InfraApi }) {
  if (data.projects.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">No projects registered.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {data.projects.map((p) => (
        <ProjectCard key={p.key} project={p} data={data} infra={infra} />
      ))}
    </div>
  );
}

function ProjectCard({ project: p, data, infra }: { project: ProjectFleet; data: Data; infra: InfraApi }) {
  const [open, setOpen] = useState(false);
  const flyApps = p.fly?.apps ?? [];
  const flyMachines = flyApps.flatMap((a) => a.machines);
  const running = flyMachines.filter((m) => m.state === "started").length;
  const neonProjects = p.neon?.projects ?? [];
  const neonComputes = neonProjects.flatMap((np) => np.endpoints);
  const neonActive = neonComputes.filter((e) => e.currentState === "active").length;

  return (
    <div className={`rounded-lg border bg-white ${p.enabled ? "border-zinc-200" : "border-zinc-200 opacity-60"}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
          <span className="font-medium text-zinc-900">{p.label}</span>
          <span className="font-mono text-xs text-zinc-400">{p.key}</span>
          {!p.enabled && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">disabled</span>}
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-600">
          <span className="inline-flex items-center gap-1">
            <Server className="h-3.5 w-3.5 text-zinc-400" />
            {flyApps.length} app{flyApps.length === 1 ? "" : "s"} · {running}/{flyMachines.length} running
          </span>
          <span className="inline-flex items-center gap-1">
            <Database className="h-3.5 w-3.5 text-zinc-400" />
            {neonProjects.length} DB{neonProjects.length === 1 ? "" : "s"} · {neonActive} active
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-3">
          <UsageStrip usage={p.usage} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {p.flyOrgSlug && (
              <a
                href={`https://fly.io/dashboard/${p.flyOrgSlug}/billing`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-coral hover:underline"
              >
                Fly billing <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {p.neonOrgId && (
              <a
                href={`https://console.neon.tech/app/orgs/${p.neonOrgId}/billing`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-coral hover:underline"
              >
                Neon billing <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <FlySection project={p} data={data} infra={infra} />
          <NeonSection project={p} data={data} infra={infra} />
        </div>
      )}
    </div>
  );
}

function UsageStrip({ usage }: { usage: UsageSeries[] }) {
  if (usage.length === 0) {
    return <p className="text-xs text-zinc-400">No usage samples yet (needs a completed sweep on a paid Neon plan / Prometheus access).</p>;
  }
  return (
    <div className="flex flex-wrap gap-4">
      {usage.map((u) => {
        const latest = u.points[u.points.length - 1];
        return (
          <div key={u.metric} className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-zinc-400">{metricLabel(u.metric)}</span>
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

// ── Fly ───────────────────────────────────────────────────────────────────────

const FLY_PRESETS: { label: string; value: string }[] = [
  { label: "shared 1x · 256 MB", value: "shared|1|256" },
  { label: "shared 1x · 512 MB", value: "shared|1|512" },
  { label: "shared 2x · 1 GB", value: "shared|2|1024" },
  { label: "shared 4x · 2 GB", value: "shared|4|2048" },
  { label: "shared 8x · 4 GB", value: "shared|8|4096" },
  { label: "performance 1x · 2 GB", value: "performance|1|2048" },
  { label: "performance 2x · 4 GB", value: "performance|2|4096" },
  { label: "performance 4x · 8 GB", value: "performance|4|8192" },
];

function FlySection({ project: p, data, infra }: { project: ProjectFleet; data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const apps = p.fly?.apps ?? [];
  if (!p.flyOrgSlug) return null;
  if (apps.length === 0) {
    return <p className="mt-3 text-xs text-zinc-400">Fly: no apps (or no read token / not swept yet).</p>;
  }
  const canWrite = p.hasFlyWriteToken;

  async function machine(app: FlyApp, m: FlyMachine, kind: "start" | "stop" | "restart" | "suspend") {
    if (!(await dialog.confirm({ title: `${kind} ${m.name || m.id}?`, confirmLabel: kind })))
      return;
    infra.post({ intent: "fly.machine", projectKey: p.key, app: app.name, machineId: m.id, kind });
  }

  async function scale(app: FlyApp, m: FlyMachine) {
    const choice = await dialog.choice({
      title: `Resize ${m.name || m.id}`,
      description: "The machine reboots into the new size (brief downtime).",
      options: FLY_PRESETS.map((x) => ({ value: x.value, label: x.label })),
    });
    if (!choice) return;
    const [cpuKind, cpus, memoryMb] = choice.split("|");
    infra.post({
      intent: "fly.scale",
      projectKey: p.key,
      app: app.name,
      machineId: m.id,
      cpuKind,
      cpus: Number(cpus),
      memoryMb: Number(memoryMb),
    });
  }

  async function destroy(app: FlyApp, target: "machine" | "app", m?: FlyMachine) {
    const name = target === "app" ? app.name : m?.name || m?.id || "";
    const typed = await dialog.prompt({
      title: `Destroy ${target} "${name}"?`,
      description: "This is irreversible.",
      label: `Type "${name}" to confirm`,
      confirmLabel: "Destroy",
      validate: (v) => (v.trim() === name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({
      intent: "fly.destroy",
      projectKey: p.key,
      target,
      app: app.name,
      ...(m ? { machineId: m.id } : {}),
    });
  }

  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Fly</h3>
      <div className="space-y-3">
        {apps.map((app) => {
          const isProtected = data.protectedFly.includes(app.name);
          return (
            <div key={app.name} className="rounded-md border border-zinc-200">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5">
                <span className="font-mono text-xs font-medium text-zinc-800">{app.name}</span>
                <span className="text-[11px] text-zinc-500">
                  {isProtected && <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">protected</span>}
                  {app.status ?? ""} · {app.machines.length} machines · {app.volumes.length} volumes
                </span>
              </div>
              {app.machines.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-400">
                    <tr>
                      <th className="px-3 py-1 font-medium">Machine</th>
                      <th className="px-3 py-1 font-medium">Size</th>
                      <th className="px-3 py-1 font-medium">Region</th>
                      <th className="px-3 py-1 font-medium">State</th>
                      <th className="px-3 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {app.machines.map((m) => (
                      <tr key={m.id} className="border-t border-zinc-50">
                        <td className="px-3 py-1.5 font-mono text-zinc-700">{m.name || m.id}</td>
                        <td className="px-3 py-1.5 text-zinc-600">
                          {m.cpuKind} {m.cpus}x · {fmtBytes(m.memoryMb * 1024 * 1024)}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-600">{m.region}</td>
                        <td className="px-3 py-1.5">
                          <StateBadge state={m.state} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {canWrite ? (
                            <div className="inline-flex flex-wrap justify-end gap-1">
                              <MiniBtn disabled={infra.busy} onClick={() => machine(app, m, m.state === "started" ? "stop" : "start")}>
                                {m.state === "started" ? "Stop" : "Start"}
                              </MiniBtn>
                              <MiniBtn disabled={infra.busy} onClick={() => machine(app, m, "restart")}>Restart</MiniBtn>
                              <MiniBtn disabled={infra.busy} onClick={() => scale(app, m)}>Resize</MiniBtn>
                              {data.isAdmin && !isProtected && (
                                <MiniBtn danger disabled={infra.busy} onClick={() => destroy(app, "machine", m)}>Destroy</MiniBtn>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-zinc-400">read-only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.isAdmin && canWrite && !isProtected && (
                <div className="border-t border-zinc-100 px-3 py-1.5 text-right">
                  <MiniBtn danger disabled={infra.busy} onClick={() => destroy(app, "app")}>Destroy app</MiniBtn>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Neon ──────────────────────────────────────────────────────────────────────

function NeonSection({ project: p, data, infra }: { project: ProjectFleet; data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  if (!p.neonOrgId) return null;
  const projects = p.neon?.projects ?? [];

  async function createProject() {
    const name = await dialog.prompt({
      title: "Create a new Neon project",
      label: "Project name",
      confirmLabel: "Create",
      validate: (v) => (v.trim().length >= 1 ? null : "Name required"),
    });
    if (name === null) return;
    infra.post({ intent: "neon.project.create", projectKey: p.key, name: name.trim() });
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Neon</h3>
        {data.isAdmin && (
          <MiniBtn disabled={infra.busy} onClick={createProject}>+ New project</MiniBtn>
        )}
      </div>
      {projects.length === 0 ? (
        <p className="text-xs text-zinc-400">No projects (or not swept yet).</p>
      ) : (
        <div className="space-y-3">
          {projects.map((np) => (
            <NeonProjectCard key={np.id} project={p} np={np} data={data} infra={infra} />
          ))}
        </div>
      )}
    </div>
  );
}

function NeonProjectCard({
  project: p,
  np,
  data,
  infra,
}: {
  project: ProjectFleet;
  np: NeonProject;
  data: Data;
  infra: InfraApi;
}) {
  const dialog = useDialog();
  const [showQuota, setShowQuota] = useState(false);
  const isProtected = data.protectedNeon.includes(np.id);

  async function endpoint(e: NeonEndpoint, kind: "suspend" | "restart" | "start") {
    if (!(await dialog.confirm({ title: `${kind} compute ${e.id}?`, confirmLabel: kind }))) return;
    infra.post({ intent: "neon.endpoint", projectKey: p.key, projectId: np.id, endpointId: e.id, kind });
  }

  async function deleteBranch(branchId: string, name: string) {
    const typed = await dialog.prompt({
      title: `Delete branch "${name}"?`,
      description: "This is irreversible.",
      label: `Type "${name}" to confirm`,
      confirmLabel: "Delete",
      validate: (v) => (v.trim() === name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({ intent: "neon.branch.delete", projectKey: p.key, projectId: np.id, branchId });
  }

  async function deleteProject() {
    const typed = await dialog.prompt({
      title: `Delete project "${np.name}"?`,
      description: "This destroys the database and all branches. Irreversible.",
      label: `Type "${np.name}" to confirm`,
      confirmLabel: "Delete project",
      validate: (v) => (v.trim() === np.name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({ intent: "neon.project.delete", projectKey: p.key, projectId: np.id });
  }

  return (
    <div className="rounded-md border border-zinc-200">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-zinc-800">{np.name}</span>
        <span className="text-[11px] text-zinc-500">
          {isProtected && <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">protected</span>}
          {np.regionId} · pg{np.pgVersion ?? "?"} · {np.branches.length} branches
        </span>
      </div>

      {/* Endpoints */}
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-400">
          <tr>
            <th className="px-3 py-1 font-medium">Compute</th>
            <th className="px-3 py-1 font-medium">Autoscale</th>
            <th className="px-3 py-1 font-medium">Scale-to-zero</th>
            <th className="px-3 py-1 font-medium">State</th>
            <th className="px-3 py-1" />
          </tr>
        </thead>
        <tbody>
          {np.endpoints.map((e) => (
            <EndpointRow key={e.id} project={p} np={np} e={e} infra={infra} endpointAction={endpoint} />
          ))}
        </tbody>
      </table>

      {/* Quota + branch controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-3 py-1.5">
        <QuotaSummary np={np} />
        <div className="flex gap-1">
          {data.isAdmin && !isProtected && (
            <MiniBtn disabled={infra.busy} onClick={() => setShowQuota((v) => !v)}>
              {showQuota ? "Hide limits" : "Set limits"}
            </MiniBtn>
          )}
          {data.isAdmin && !isProtected && (
            <MiniBtn danger disabled={infra.busy} onClick={deleteProject}>Delete project</MiniBtn>
          )}
        </div>
      </div>

      {showQuota && data.isAdmin && !isProtected && (
        <QuotaEditor project={p} np={np} infra={infra} onClose={() => setShowQuota(false)} />
      )}

      {/* Non-default branches */}
      {np.branches.filter((b) => !b.default).length > 0 && (
        <div className="border-t border-zinc-100 px-3 py-1.5">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Branches</p>
          <div className="flex flex-wrap gap-1.5">
            {np.branches
              .filter((b) => !b.default)
              .map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1 rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600">
                  {b.name}
                  {data.isAdmin && !isProtected && (
                    <button
                      type="button"
                      disabled={infra.busy}
                      onClick={() => deleteBranch(b.id, b.name)}
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EndpointRow({
  project: p,
  np,
  e,
  infra,
  endpointAction,
}: {
  project: ProjectFleet;
  np: NeonProject;
  e: NeonEndpoint;
  infra: InfraApi;
  endpointAction: (e: NeonEndpoint, kind: "suspend" | "restart" | "start") => void;
}) {
  const [minCu, setMinCu] = useState(String(e.autoscalingMinCu ?? ""));
  const [maxCu, setMaxCu] = useState(String(e.autoscalingMaxCu ?? ""));
  const [timeout, setTimeoutS] = useState(String(e.suspendTimeoutSeconds ?? ""));
  const dirty =
    Number(minCu) !== (e.autoscalingMinCu ?? NaN) ||
    Number(maxCu) !== (e.autoscalingMaxCu ?? NaN) ||
    Number(timeout) !== (e.suspendTimeoutSeconds ?? NaN);

  function saveAutoscale() {
    infra.post({
      intent: "neon.autoscale",
      projectKey: p.key,
      projectId: np.id,
      endpointId: e.id,
      ...(minCu ? { minCu: Number(minCu) } : {}),
      ...(maxCu ? { maxCu: Number(maxCu) } : {}),
      ...(timeout ? { suspendTimeoutSeconds: Number(timeout) } : {}),
    });
  }

  return (
    <tr className="border-t border-zinc-50">
      <td className="px-3 py-1.5 font-mono text-zinc-700">
        {e.id}
        <span className="ml-1 text-[10px] text-zinc-400">{e.type}</span>
      </td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-zinc-600">
          <NumInput value={minCu} onChange={setMinCu} />–<NumInput value={maxCu} onChange={setMaxCu} /> CU
        </span>
      </td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-zinc-600">
          <NumInput value={timeout} onChange={setTimeoutS} width="w-16" /> s
        </span>
      </td>
      <td className="px-3 py-1.5">
        <StateBadge state={e.currentState} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          {dirty && (
            <MiniBtn disabled={infra.busy} onClick={saveAutoscale}>Save</MiniBtn>
          )}
          <MiniBtn disabled={infra.busy} onClick={() => endpointAction(e, e.currentState === "idle" ? "start" : "suspend")}>
            {e.currentState === "idle" ? "Start" : "Suspend"}
          </MiniBtn>
          <MiniBtn disabled={infra.busy} onClick={() => endpointAction(e, "restart")}>Restart</MiniBtn>
        </div>
      </td>
    </tr>
  );
}

function QuotaSummary({ np }: { np: NeonProject }) {
  const q = np.quota;
  const parts: string[] = [];
  if (q.computeTimeSeconds) parts.push(`compute ${fmtHours(q.computeTimeSeconds)}`);
  if (q.activeTimeSeconds) parts.push(`active ${fmtHours(q.activeTimeSeconds)}`);
  if (q.writtenDataBytes) parts.push(`written ${fmtBytes(q.writtenDataBytes)}`);
  if (q.dataTransferBytes) parts.push(`egress ${fmtBytes(q.dataTransferBytes)}`);
  if (q.logicalSizeBytes) parts.push(`size ${fmtBytes(q.logicalSizeBytes)}`);
  return (
    <span className="text-[11px] text-zinc-500">
      Limits: {parts.length ? parts.join(" · ") : "none (unlimited)"}
    </span>
  );
}

function QuotaEditor({
  project: p,
  np,
  infra,
  onClose,
}: {
  project: ProjectFleet;
  np: NeonProject;
  infra: InfraApi;
  onClose: () => void;
}) {
  const dialog = useDialog();
  const [computeHours, setComputeHours] = useState(np.quota.computeTimeSeconds ? String(np.quota.computeTimeSeconds / 3600) : "");
  const [transferGb, setTransferGb] = useState(np.quota.dataTransferBytes ? String(np.quota.dataTransferBytes / 1e9) : "");
  const [sizeGb, setSizeGb] = useState(np.quota.logicalSizeBytes ? String(np.quota.logicalSizeBytes / 1e9) : "");

  async function save() {
    const ok = await dialog.confirm({
      title: "Set project limits?",
      tone: "destructive",
      confirmLabel: "Set limits",
      description:
        "Warning: when a billing-period limit is hit, Neon suspends this project's compute until the next billing period — a normal connection will NOT wake it. Set 0 to leave unlimited.",
    });
    if (!ok) return;
    const quota: Record<string, number> = {};
    if (computeHours !== "") quota.compute_time_seconds = Math.round(Number(computeHours) * 3600);
    if (transferGb !== "") quota.data_transfer_bytes = Math.round(Number(transferGb) * 1e9);
    if (sizeGb !== "") quota.logical_size_bytes = Math.round(Number(sizeGb) * 1e9);
    if (Object.keys(quota).length === 0) return;
    infra.post({ intent: "neon.quota", projectKey: p.key, projectId: np.id, quota });
    onClose();
  }

  return (
    <div className="border-t border-zinc-100 bg-amber-50/40 px-3 py-2">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">Compute (h/mo)</span>
          <NumInput value={computeHours} onChange={setComputeHours} width="w-20" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">Egress (GB/mo)</span>
          <NumInput value={transferGb} onChange={setTransferGb} width="w-20" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">Branch size (GB)</span>
          <NumInput value={sizeGb} onChange={setSizeGb} width="w-20" />
        </label>
        <MiniBtn disabled={infra.busy} onClick={save}>Save limits</MiniBtn>
        <span className="text-[11px] text-zinc-400">0 or blank = unlimited</span>
      </div>
    </div>
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function Cleanup({ data, infra }: { data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const items = data.cleanup;
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">Nothing idle to review.</p>;
  }

  async function reap(c: CleanupCandidate) {
    if (c.protected) return;
    const typed = await dialog.prompt({
      title: `Reap ${c.kind} "${c.name}"?`,
      description: "This is irreversible.",
      label: `Type "${c.name}" to confirm`,
      confirmLabel: "Reap",
      validate: (v) => (v.trim() === c.name ? null : "Names don't match"),
    });
    if (typed === null) return;
    const [a, b] = c.resourceId.split(":");
    const body: Record<string, unknown> = { intent: "reap", projectKey: c.projectKey, kind: c.kind };
    if (c.kind === "fly-app") body.app = c.resourceId;
    if (c.kind === "neon-branch") {
      body.projectId = a;
      body.branchId = b;
    }
    if (c.kind === "neon-endpoint") {
      body.projectId = a;
      body.endpointId = b;
    }
    infra.post(body);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">Resource</th>
            <th className="px-3 py-2">Detail</th>
            <th className="px-3 py-2 text-center">Idle</th>
            <th className="px-3 py-2 text-center">Age</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={`${c.projectKey}:${c.kind}:${c.resourceId}`} className="border-b border-zinc-100 last:border-0">
              <td className="px-3 py-2 text-zinc-600">{c.projectLabel}</td>
              <td className="px-3 py-2">
                <span className="font-mono text-xs text-zinc-800">{c.name}</span>
                <span className="ml-1 text-[11px] text-zinc-400">{c.kind}</span>
                {c.protected && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700">protected</span>}
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500">{c.detail}</td>
              <td className="px-3 py-2 text-center text-xs text-zinc-600">{c.idleDays != null ? `${c.idleDays}d` : "—"}</td>
              <td className="px-3 py-2 text-center text-xs text-zinc-600">{c.ageDays != null ? `${c.ageDays}d` : "—"}</td>
              <td className="px-3 py-2 text-right">
                {data.isAdmin && !c.protected ? (
                  <MiniBtn danger disabled={infra.busy} onClick={() => reap(c)}>Reap</MiniBtn>
                ) : (
                  <span className="text-[11px] text-zinc-400">{c.protected ? "protected" : "admin only"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Registry (Admin) ──────────────────────────────────────────────────────────

function Registry({ data, infra }: { data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(key: string) {
    if (!(await dialog.confirm({ title: `Remove project "${key}"?`, tone: "destructive", description: "Removes it from the registry (its cloud resources are untouched)." })))
      return;
    infra.post({ intent: "delete", key }, "/api/infra/registry");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          One Fly org + Neon org per project. Fly tokens are encrypted at rest; token fields are
          write-only (blank leaves them unchanged).
        </p>
        <button type="button" className={buttonClasses("primary", "sm")} onClick={() => setAdding(true)}>
          + Add project
        </button>
      </div>

      {adding && (
        <ProjectForm data={data} infra={infra} onDone={() => setAdding(false)} />
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Fly org</th>
              <th className="px-3 py-2">Neon org</th>
              <th className="px-3 py-2 text-center">Tokens</th>
              <th className="px-3 py-2 text-center">Enabled</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <Fragment key={p.key}>
                <tr className="border-b border-zinc-100">
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-800">{p.label}</span>
                    <span className="ml-1 font-mono text-xs text-zinc-400">{p.key}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{p.flyOrgSlug ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{p.neonOrgId ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-[11px] text-zinc-500">
                    {p.hasFlyReadToken ? "read" : "—"} / {p.hasFlyWriteToken ? "write" : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">{p.enabled ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <MiniBtn disabled={infra.busy} onClick={() => setEditing(editing === p.key ? null : p.key)}>Edit</MiniBtn>
                      <MiniBtn danger disabled={infra.busy} onClick={() => remove(p.key)}>Remove</MiniBtn>
                    </div>
                  </td>
                </tr>
                {editing === p.key && (
                  <tr>
                    <td colSpan={6} className="bg-zinc-50 px-3 py-2">
                      <ProjectForm data={data} infra={infra} existing={p} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data.projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-zinc-500">No projects registered.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectForm({
  data,
  infra,
  existing,
  onDone,
}: {
  data: Data;
  infra: InfraApi;
  existing?: ProjectFleet;
  onDone: () => void;
}) {
  const [key, setKey] = useState(existing?.key ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [flyOrgSlug, setFlyOrgSlug] = useState(existing?.flyOrgSlug ?? "");
  const [neonOrgId, setNeonOrgId] = useState(existing?.neonOrgId ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [flyReadToken, setFlyReadToken] = useState("");
  const [flyWriteToken, setFlyWriteToken] = useState("");

  function submit() {
    infra.post(
      {
        intent: "save",
        key,
        label,
        flyOrgSlug: flyOrgSlug || null,
        neonOrgId: neonOrgId || null,
        enabled,
        ...(flyReadToken ? { flyReadToken } : {}),
        ...(flyWriteToken ? { flyWriteToken } : {}),
      },
      "/api/infra/registry",
    );
    onDone();
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap gap-3">
        <Field label="Key (slug)">
          <TextInput value={key} onChange={setKey} disabled={!!existing} placeholder="acme-app" />
        </Field>
        <Field label="Label">
          <TextInput value={label} onChange={setLabel} placeholder="Acme App" />
        </Field>
        <Field label="Fly org slug">
          <TextInput value={flyOrgSlug} onChange={setFlyOrgSlug} placeholder="acme-org" />
        </Field>
        <Field label="Neon org id">
          <TextInput value={neonOrgId} onChange={setNeonOrgId} placeholder="org-acme-1234" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Fly read token (write-only)">
          <TextInput value={flyReadToken} onChange={setFlyReadToken} type="password" placeholder={existing?.hasFlyReadToken ? "•••• set — blank keeps" : "FlyV1 …"} disabled={!data.cryptoConfigured} />
        </Field>
        <Field label="Fly write token (write-only)">
          <TextInput value={flyWriteToken} onChange={setFlyWriteToken} type="password" placeholder={existing?.hasFlyWriteToken ? "•••• set — blank keeps" : "FlyV1 …"} disabled={!data.cryptoConfigured} />
        </Field>
        <label className="flex items-center gap-1.5 self-end text-zinc-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={infra.busy || !key || !label} className={buttonClasses("primary", "sm")} onClick={submit}>
          Save
        </button>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────

function MiniBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
        danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function StateBadge({ state }: { state: string }) {
  const good = state === "started" || state === "active";
  const idle = state === "idle" || state === "stopped" || state === "suspended";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        good ? "bg-green-100 text-green-800" : idle ? "bg-zinc-200 text-zinc-600" : "bg-amber-100 text-amber-800"
      }`}
    >
      {state}
    </span>
  );
}

function NumInput({ value, onChange, width = "w-12" }: { value: string; onChange: (v: string) => void; width?: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded border border-zinc-300 px-1 py-0.5 text-xs`}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-44 rounded border border-zinc-300 px-2 py-1 text-xs disabled:bg-zinc-100"
    />
  );
}
