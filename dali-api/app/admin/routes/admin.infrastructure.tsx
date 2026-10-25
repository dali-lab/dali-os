// Admin → Platform → Infrastructure. The lab-wide Fly.io + Neon fleet console
// (Core/Admin): per-project inventory + usage, plus scale / limit / provision /
// cleanup actions and the member change-request queue. Renders from cached
// snapshots (the infra-snapshot job sweeps); "Refresh" re-runs the sweep.
// Per-project config lives on the Project row and is edited in each project's
// hub. Behind the `infra-dashboard` flag.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  Gauge,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { Route } from "./+types/admin.infrastructure";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Figure, Pill, adminTable, type Tone } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { Segmented } from "~/components/ui/Segmented";
import { MultiSelect, Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadFleet, buildCleanup } from "~/lib/infra/dashboard.server";
import type { ProjectFleet, CleanupCandidate } from "~/lib/infra/dashboard.server";
import type { FlyApp, FlyMachine, NeonProject, NeonEndpoint } from "~/lib/infra/types";
import { infraCryptoConfigured } from "~/lib/infra/crypto.server";
import { neonConfigured } from "~/lib/infra/neon.server";
import { listPendingInfraRequests } from "~/lib/infra/requests.server";
import { infraRequestKindLabel } from "~/lib/infra/request-kinds";
import { useDialog } from "~/components/ui/dialog";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import { InfraConfigFields, withOwnOrg } from "~/components/infra/InfraConfigFields";
import { VaultSection } from "~/components/infra/VaultSection";
import { vaultwardenConfigured, vaultwardenSyncConfigured } from "~/lib/infra/vaultwarden.server";
import {
  ColWidths,
  consoleUrl,
  ExternalIconLink,
  fmtBytes,
  fmtHours,
  fmtUsd,
  INFRA_COLS,
  NeonBranchUsageTable,
  NeonCostLine,
  plural,
  timeAgo,
  UsageStrip,
  volumeSummary,
} from "~/components/infra/format";

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

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);
  const { projects, unlinked, unlinkedVaultGroups, knownOrgs, lastSweep, protectedFly, protectedNeon } = await loadFleet({
    all: true,
    termId: isAll ? null : termId,
  });
  const cleanup = buildCleanup([...projects, ...unlinked]);
  const requests = await listPendingInfraRequests();

  return {
    isAdmin: roles.isAdmin,
    cryptoConfigured: infraCryptoConfigured(),
    neonConfigured: neonConfigured(),
    lastSweep,
    protectedFly,
    protectedNeon,
    projects,
    unlinked,
    unlinkedVaultGroups,
    vaultConfigured: vaultwardenConfigured(),
    vaultSyncConfigured: vaultwardenSyncConfigured(),
    knownOrgs,
    terms,
    selectedTerm: selected,
    cleanup,
    requests,
  };
}

type Data = Route.ComponentProps["loaderData"];

// ── Action plumbing ───────────────────────────────────────────────────────────

type ActionResult = { ok?: boolean; error?: string };

type InfraApi = {
  post: (body: Record<string, unknown>, endpoint?: string) => void;
  busy: boolean;
  error: string | null;
};

function useInfra(): InfraApi {
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  // Revalidate on success so state reflects the change without a reload.
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

export function stateTone(state: string): Tone {
  if (state === "started" || state === "active") return "ok";
  if (state === "idle" || state === "stopped" || state === "suspended") return "idle";
  return "warn";
}

export function fleetTotals(projects: Pick<ProjectFleet, "fly" | "neon">[]) {
  const apps = projects.flatMap((p) => p.fly?.apps ?? []);
  const machines = apps.flatMap((a) => a.machines);
  const computes = projects.flatMap((p) => (p.neon?.projects ?? []).flatMap((np) => np.endpoints));
  return {
    apps: apps.length,
    machines: machines.length,
    running: machines.filter((m) => m.state === "started").length,
    computes: computes.length,
    activeComputes: computes.filter((e) => e.currentState === "active").length,
  };
}

type Tab = "overview" | "cleanup" | "requests";

export default function AdminInfrastructure() {
  const data = useLoaderData<typeof loader>();
  const infra = useInfra();
  const { actionBtn } = useOsChrome();
  const [tab, setTab] = useState<Tab>("overview");
  const totals = fleetTotals(data.projects);

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader
        section="platform"
        actions={
          <>
            <TermFilter terms={data.terms} selected={data.selectedTerm} />
            <span className="text-xs text-os-muted">Last sweep {timeAgo(data.lastSweep)}</span>
            <button
              type="button"
              disabled={infra.busy}
              onClick={() => infra.post({ intent: "refresh" }, "/api/infra/registry")}
              className={cn(actionBtn(), "disabled:opacity-50")}
            >
              <RefreshCw className={cn("h-4 w-4", infra.busy && "animate-spin")} />
              Refresh
            </button>
          </>
        }
      />

      <p className="-mt-2 text-sm text-os-grey">
        Fly.io and Neon for every project in the term. Set up a project's infra here or in its workspace.
        Data is cached; Refresh sweeps again.
      </p>

      {infra.error && (
        <div className="flex items-start gap-2 rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{infra.error}</span>
        </div>
      )}

      <ConfigWarnings data={data} />

      <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
        <Figure size="lg" label="Projects" value={data.projects.length} />
        <Figure label="Not configured" value={data.projects.filter((p) => !p.configured).length} />
        <Figure label="Fly apps" value={totals.apps} />
        <Figure label="Machines running" value={`${totals.running}/${totals.machines}`} />
        <Figure label="Neon computes active" value={`${totals.activeComputes}/${totals.computes}`} />
        {data.cleanup.length > 0 && (
          <p className="text-sm text-os-grey md:ml-auto">
            {data.cleanup.length} idle {data.cleanup.length === 1 ? "resource is" : "resources are"} up for
            cleanup.
          </p>
        )}
      </div>

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        ariaLabel="Infrastructure view"
        className="self-start"
        options={[
          { value: "overview", label: "Overview" },
          { value: "cleanup", label: "Cleanup", count: data.cleanup.length || undefined },
          { value: "requests", label: "Requests", count: data.requests.length || undefined },
        ]}
      />

      {tab === "overview" && <Overview data={data} infra={infra} />}
      {tab === "cleanup" && <Cleanup data={data} infra={infra} />}
      {tab === "requests" && <Requests data={data} infra={infra} />}
    </div>
  );
}

function ConfigWarnings({ data }: { data: Data }) {
  const warnings: string[] = [];
  if (!data.cryptoConfigured)
    warnings.push("INFRA_SECRET_KEY is not set, so Fly tokens can't be stored and Fly actions are unavailable.");
  if (!data.neonConfigured)
    warnings.push("INFRA_NEON_API_KEY is not set, so Neon inventory, usage, and actions are unavailable.");
  if (data.vaultConfigured && !data.vaultSyncConfigured)
    warnings.push("VAULTWARDEN_ORG_CLIENT_ID/SECRET are not set, so Vaultwarden groups can be viewed but not synced.");
  if (data.projects.length > 0 && data.projects.every((p) => !p.configured))
    warnings.push("None of these projects has infra configured yet. Open one to set it up.");
  if (warnings.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-os-item bg-os-amber/10 px-4 py-3 text-sm text-os-amber">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <ul className="flex flex-col gap-0.5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ data, infra }: { data: Data; infra: InfraApi }) {
  const { panel } = useOsChrome();
  if (data.projects.length === 0 && data.unlinked.length === 0 && data.unlinkedVaultGroups.length === 0) {
    return (
      <div className={panel}>
        <EmptyState>No projects in this term.</EmptyState>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {data.projects.length > 0 && (
        <ul className={panel}>
          {data.projects.map((p, i) => (
            <ProjectCard key={p.projectId} project={p} data={data} infra={infra} first={i === 0} />
          ))}
        </ul>
      )}
      {(data.unlinked.length > 0 || data.unlinkedVaultGroups.length > 0) && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-os-muted">Not linked to a project</h3>
          <p className="text-xs text-os-grey">
            Apps and databases in a shared org that no project has claimed. Link them from a project's config.
          </p>
          {data.unlinked.length > 0 && (
            <ul className={panel}>
              {data.unlinked.map((p, i) => (
                <ProjectCard key={p.name} project={p} data={data} infra={infra} first={i === 0} />
              ))}
            </ul>
          )}
          <UnlinkedVaultGroups groups={data.unlinkedVaultGroups} />
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project: p,
  data,
  infra,
  first,
}: {
  project: ProjectFleet;
  data: Data;
  infra: InfraApi;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const flyApps = p.fly?.apps ?? [];
  const flyMachines = flyApps.flatMap((a) => a.machines);
  const running = flyMachines.filter((m) => m.state === "started").length;
  const neonProjects = p.neon?.projects ?? [];
  const neonComputes = neonProjects.flatMap((np) => np.endpoints);
  const neonActive = neonComputes.filter((e) => e.currentState === "active").length;

  return (
    <li className={cn(!first && "border-t border-os-container/70")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <span className={cn("flex items-center gap-2.5", !p.infraEnabled && "opacity-60")}>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-os-muted transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <span className="font-semibold text-foreground">{p.name}</span>
          {!p.unlinked && !p.configured && (
            <Pill tone="warn">
              <AlertTriangle className="h-3 w-3" /> Not configured
            </Pill>
          )}
          {p.configured && !p.infraEnabled && <Pill tone="idle">Sweep off</Pill>}
        </span>
        <span className="flex items-center gap-5 text-sm text-os-grey">
          <span className="inline-flex items-center gap-1.5">
            <Server className="h-4 w-4 text-os-muted" />
            {flyApps.length} app{flyApps.length === 1 ? "" : "s"} · {running}/{flyMachines.length} running
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Database className="h-4 w-4 text-os-muted" />
            {neonProjects.length} DB{neonProjects.length === 1 ? "" : "s"} · {neonActive} active
          </span>
        </span>
      </button>

      {open && !p.configured && !p.unlinked && (
        <div className="border-t border-os-container/70 px-6 py-5">
          <ConfigEditor project={p} data={data} startOpen />
        </div>
      )}
      {open && (p.configured || p.unlinked) && (
        <div className="flex flex-col gap-6 border-t border-os-container/70 px-6 py-5">
          {!p.unlinked && <ConfigEditor project={p} data={data} />}
          <div className="flex flex-col gap-3">
            <UsageStrip usage={p.usage} />
            <div className="flex flex-wrap gap-4 text-sm">
              {p.flyOrgSlug && (
                <a
                  href={`https://fly.io/dashboard/${p.flyOrgSlug}/billing`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-os-accent hover:text-os-accent-hover"
                >
                  Fly billing <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {p.neonOrgId && (
                <a
                  href={consoleUrl.neonOrg(p.neonOrgId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-os-accent hover:text-os-accent-hover"
                >
                  Neon billing <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <NeonCostLine plan={p.neonPlan} cost={p.neonCost} />
            </div>
          </div>
          <FlySection project={p} data={data} infra={infra} />
          <NeonSection project={p} data={data} infra={infra} />
          {p.vault && <VaultAdmin project={p} infra={infra} collections={data.knownOrgs.vaultCollections} />}
        </div>
      )}
    </li>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

function ConfigEditor({ project: p, data, startOpen = false }: { project: ProjectFleet; data: Data; startOpen?: boolean }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const { actionBtn } = useOsChrome();
  const [editing, setEditing] = useState(startOpen);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditing(false);
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs text-os-grey">
        <span>
          Fly {p.flyOrgSlug ?? "not set"} · {plural(p.flyAppNames.length, "app")} · Neon {p.neonOrgId ?? "not set"} ·{" "}
          {plural(p.neonProjectIds.length, "database")}
        </span>
        <button type="button" onClick={() => setEditing(true)} className={actionBtn()}>
          <SlidersHorizontal className="h-4 w-4" /> Edit config
        </button>
      </div>
    );
  }
  return (
    <fetcher.Form method="post" action="/api/infra/config" key={resetKey} className="os-form flex flex-col gap-4">
      <input type="hidden" name="projectId" value={p.projectId} />
      <InfraConfigFields
        config={p}
        knownOrgs={{
          fly: withOwnOrg(data.knownOrgs.fly, p.flyOrgSlug, p.flyOrgApps),
          neon: withOwnOrg(data.knownOrgs.neon, p.neonOrgId, p.neonOrgProjects),
          vaultGroups: data.knownOrgs.vaultGroups,
        }}
      />
      {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={fetcher.state !== "idle"} className="os-btn-primary">
          {fetcher.state !== "idle" ? "Saving…" : "Save"}
        </button>
        {!startOpen && (
          <button
            type="button"
            className="os-btn-ghost"
            onClick={() => {
              setEditing(false);
              setResetKey((k) => k + 1);
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </fetcher.Form>
  );
}

// ── Vaultwarden ───────────────────────────────────────────────────────────────

function VaultAdmin({
  project: p,
  infra,
  collections,
}: {
  project: ProjectFleet;
  infra: InfraApi;
  collections: { id: string; name: string }[];
}) {
  const dialog = useDialog();
  const [granted, setGranted] = useState(() => p.vault?.collections.map((c) => c.id) ?? []);
  if (!p.vault) return null;
  const post = (body: Record<string, unknown>) => infra.post({ projectId: p.projectId, ...body });
  const current = p.vault.collections.map((c) => c.id);
  const dirty = granted.length !== current.length || granted.some((id) => !current.includes(id));
  return (
    <div className="flex flex-col gap-3">
      <VaultSection
        vault={p.vault}
        orgUrl={p.vaultOrgUrl}
        actions={{
          busy: infra.busy,
          sync: () => post({ intent: "vault.sync" }),
          remove: async (email) => {
            const ok = await dialog.confirm({
              title: `Remove ${email} from ${p.vault!.group.name}?`,
              description: "They lose access to this group's collections. Their Vaultwarden account and other groups stay.",
              confirmLabel: "Remove",
              tone: "destructive",
            });
            if (ok) post({ intent: "vault.sync", remove: [email] });
          },
          member: async (memberId, action) => {
            if (action === "revoke") {
              const ok = await dialog.confirm({
                title: "Revoke this member?",
                description: "Revoking removes their access to the whole org until restored.",
                confirmLabel: "Revoke",
                tone: "destructive",
              });
              if (!ok) return;
            }
            post({ intent: "vault.member", memberId, action });
          },
        }}
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-os-muted">
          <span>Collections this group can open</span>
          <MultiSelect
            ariaLabel="Collections this group can open"
            values={granted}
            options={collections.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setGranted}
            placeholder="None"
            emptyLabel="No collections in the org yet. Create one in Vaultwarden."
          />
        </div>
        {dirty && (
          <button
            type="button"
            disabled={infra.busy}
            onClick={() => post({ intent: "vault.collections", collectionIds: granted })}
            className="os-btn-primary"
          >
            Save collections
          </button>
        )}
      </div>
    </div>
  );
}

function UnlinkedVaultGroups({ groups }: { groups: { id: string; name: string; memberCount: number }[] }) {
  const { panel } = useOsChrome();
  if (groups.length === 0) return null;
  return (
    <div className={cn(panel, "px-6 py-4")}>
      <p className="mb-2 text-sm font-semibold text-foreground">Vaultwarden groups</p>
      <ul className="flex flex-col gap-1 text-sm text-os-grey">
        {groups.map((g) => (
          <li key={g.id}>
            {g.name} · {plural(g.memberCount, "member")}
          </li>
        ))}
      </ul>
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

const subTable = {
  wrap: "overflow-x-auto rounded-os-item border border-os-container/70",
  th: "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-os-muted",
  td: "px-4 py-2.5 text-sm",
  row: "border-t border-os-container/70",
};

function FlySection({ project: p, data, infra }: { project: ProjectFleet; data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const apps = p.fly?.apps ?? [];
  if (!p.flyOrgSlug) return null;
  if (apps.length === 0) {
    return <p className="text-sm text-os-muted">Fly: no apps (or no read token, or not swept yet).</p>;
  }
  const canWrite = p.hasFlyWriteToken;

  async function machine(app: FlyApp, m: FlyMachine, kind: "start" | "stop" | "restart" | "suspend") {
    const halts = kind === "stop" || kind === "suspend";
    if (
      !(await dialog.confirm({
        title: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${m.name || m.id}?`,
        description: halts ? "Anything served by this machine goes down until it starts again." : undefined,
        confirmLabel: kind,
        tone: halts ? "destructive" : "default",
      }))
    )
      return;
    infra.post({ intent: "fly.machine", projectId: p.projectId, app: app.name, machineId: m.id, kind });
  }

  async function scale(app: FlyApp, m: FlyMachine) {
    const current = `${m.cpuKind}|${m.cpus}|${m.memoryMb}`;
    const currentLabel = FLY_PRESETS.find((x) => x.value === current)?.label ?? `${m.cpuKind} ${m.cpus}x · ${fmtBytes(m.memoryMb * 1024 * 1024)}`;
    const choice = await dialog.choice({
      title: `Resize machine ${m.name || m.id}`,
      description: (
        <>
          App <span className="font-mono text-foreground">{app.name}</span> · now{" "}
          <span className="font-medium text-foreground">{currentLabel}</span>. The machine reboots into the new size
          (brief downtime).
        </>
      ),
      options: FLY_PRESETS.map((x) => ({ value: x.value, label: x.label })),
      selected: current,
    });
    if (!choice) return;
    const [cpuKind, cpus, memoryMb] = choice.split("|");
    infra.post({ intent: "fly.scale", projectId: p.projectId, app: app.name, machineId: m.id, cpuKind, cpus: Number(cpus), memoryMb: Number(memoryMb) });
  }

  async function destroy(app: FlyApp, target: "machine" | "app", m?: FlyMachine) {
    const name = target === "app" ? app.name : m?.name || m?.id || "";
    const typed = await dialog.prompt({
      title: `Destroy ${target} "${name}"?`,
      tone: "destructive",
      description: "This is irreversible.",
      label: `Type "${name}" to confirm`,
      confirmLabel: "Destroy",
      validate: (v) => (v.trim() === name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({ intent: "fly.destroy", projectId: p.projectId, target, app: app.name, ...(m ? { machineId: m.id } : {}) });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-os-muted">Fly</h3>
      {apps.map((app) => {
        const isProtected = data.protectedFly.includes(app.name);
        return (
          <div key={app.name} className={subTable.wrap}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-foreground">{app.name}</span>
                <ExternalIconLink href={consoleUrl.flyApp(app.name)} label="Open in Fly" />
                {isProtected && <Pill>Protected</Pill>}
              </span>
              <span className="flex items-center gap-2 text-xs text-os-grey">
                {app.status && <Pill tone={app.status === "deployed" ? "ok" : "idle"}>{app.status}</Pill>}
                {plural(app.machines.length, "machine")} · {volumeSummary(app.volumes)}
                {data.isAdmin && canWrite && !isProtected && (
                  <IconAction label="Destroy app" danger disabled={infra.busy} onClick={() => destroy(app, "app")}>
                    <Trash2 className="h-4 w-4" />
                  </IconAction>
                )}
              </span>
            </div>
            {app.machines.length > 0 && (
              <table className="w-full min-w-[640px] table-fixed">
                <ColWidths widths={INFRA_COLS.flyConsole} />
                <thead>
                  <tr className={subTable.row}>
                    <th className={subTable.th}>Machine</th>
                    <th className={subTable.th}>Size</th>
                    <th className={subTable.th}>Region</th>
                    <th className={subTable.th}>State</th>
                    <th className={subTable.th} />
                  </tr>
                </thead>
                <tbody>
                  {app.machines.map((m) => (
                    <tr key={m.id} className={subTable.row}>
                      <td className={cn(subTable.td, "font-mono text-[13px] text-foreground")}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{m.name || m.id}</span>
                          <ExternalIconLink href={consoleUrl.flyMachine(app.name, m.id)} label="Open machine in Fly" />
                        </span>
                      </td>
                      <td className={cn(subTable.td, "text-os-grey")}>
                        {m.cpuKind} {m.cpus}x · {fmtBytes(m.memoryMb * 1024 * 1024)}
                      </td>
                      <td className={cn(subTable.td, "font-mono text-xs uppercase text-os-grey")}>{m.region}</td>
                      <td className={subTable.td}>
                        <Pill tone={stateTone(m.state)}>{m.state}</Pill>
                      </td>
                      <td className={cn(subTable.td, "text-right")}>
                        {canWrite ? (
                          <div className="inline-flex justify-end gap-0.5">
                            {m.state === "started" ? (
                              <IconAction label="Stop" disabled={infra.busy} onClick={() => machine(app, m, "stop")}>
                                <Square className="h-4 w-4" />
                              </IconAction>
                            ) : (
                              <IconAction label="Start" disabled={infra.busy} onClick={() => machine(app, m, "start")}>
                                <Play className="h-4 w-4" />
                              </IconAction>
                            )}
                            <IconAction label="Restart" disabled={infra.busy} onClick={() => machine(app, m, "restart")}>
                              <RotateCw className="h-4 w-4" />
                            </IconAction>
                            <IconAction label="Resize" disabled={infra.busy} onClick={() => scale(app, m)}>
                              <Gauge className="h-4 w-4" />
                            </IconAction>
                            {data.isAdmin && !isProtected && (
                              <IconAction label="Destroy machine" danger disabled={infra.busy} onClick={() => destroy(app, "machine", m)}>
                                <Trash2 className="h-4 w-4" />
                              </IconAction>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-os-muted">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Neon ──────────────────────────────────────────────────────────────────────

function NeonSection({ project: p, data, infra }: { project: ProjectFleet; data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const { actionBtn } = useOsChrome();
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
    infra.post({ intent: "neon.project.create", projectId: p.projectId, name: name.trim() });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-os-muted">Neon</h3>
        {data.isAdmin && (
          <button type="button" disabled={infra.busy} onClick={createProject} className={cn(actionBtn(), "disabled:opacity-50")}>
            <Plus className="h-4 w-4" /> New project
          </button>
        )}
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-os-muted">
          {p.neonProjectIds.length === 0
            ? "No Neon databases linked. Pick them in the project's Infrastructure section."
            : "No projects (or not swept yet)."}
        </p>
      ) : (
        projects.map((np) => <NeonProjectCard key={np.id} project={p} np={np} data={data} infra={infra} />)
      )}
    </div>
  );
}

function NeonProjectCard({ project: p, np, data, infra }: { project: ProjectFleet; np: NeonProject; data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const [showQuota, setShowQuota] = useState(false);
  const isProtected = data.protectedNeon.includes(np.id);
  const canManage = data.isAdmin && !isProtected;
  const branches = np.branches.filter((b) => !b.default);

  async function endpoint(e: NeonEndpoint, kind: "suspend" | "restart" | "start") {
    const halts = kind === "suspend";
    if (
      !(await dialog.confirm({
        title: `${kind[0]!.toUpperCase()}${kind.slice(1)} compute ${e.id}?`,
        description: halts ? "Queries against this endpoint fail until it starts again." : undefined,
        confirmLabel: kind,
        tone: halts ? "destructive" : "default",
      }))
    )
      return;
    infra.post({ intent: "neon.endpoint", projectId: p.projectId, neonProjectId: np.id, endpointId: e.id, kind });
  }

  async function deleteBranch(branchId: string, name: string) {
    const typed = await dialog.prompt({
      title: `Delete branch "${name}"?`,
      description: "This is irreversible.",
      tone: "destructive",
      label: `Type "${name}" to confirm`,
      confirmLabel: "Delete",
      validate: (v) => (v.trim() === name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({ intent: "neon.branch.delete", projectId: p.projectId, neonProjectId: np.id, branchId });
  }

  async function deleteProject() {
    const typed = await dialog.prompt({
      title: `Delete project "${np.name}"?`,
      description: "This destroys the database and all branches. Irreversible.",
      tone: "destructive",
      label: `Type "${np.name}" to confirm`,
      confirmLabel: "Delete project",
      validate: (v) => (v.trim() === np.name ? null : "Names don't match"),
    });
    if (typed === null) return;
    infra.post({ intent: "neon.project.delete", projectId: p.projectId, neonProjectId: np.id });
  }

  return (
    <div className={subTable.wrap}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium text-foreground">{np.name}</span>
          <ExternalIconLink href={consoleUrl.neonProject(np.id)} label="Open in Neon" />
          {isProtected && <Pill>Protected</Pill>}
        </span>
        <span className="flex items-center gap-2 text-xs text-os-grey">
          {np.regionId} · pg{np.pgVersion ?? "?"} · {plural(np.branches.length, "branch", "branches")}
          {p.neonCost?.byProject[np.id] != null && ` · est. ${fmtUsd(p.neonCost.byProject[np.id])} this month`}
          {canManage && (
            <IconAction
              label={showQuota ? "Hide limits" : "Set limits"}
              active={showQuota}
              disabled={infra.busy}
              onClick={() => setShowQuota((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </IconAction>
          )}
          {canManage && (
            <IconAction label="Delete project" danger disabled={infra.busy} onClick={deleteProject}>
              <Trash2 className="h-4 w-4" />
            </IconAction>
          )}
        </span>
      </div>

      <table className="w-full min-w-[640px] table-fixed">
        <ColWidths widths={INFRA_COLS.neonConsole} />
        <thead>
          <tr className={subTable.row}>
            <th className={subTable.th}>Compute</th>
            <th className={subTable.th}>Autoscale</th>
            <th className={subTable.th}>Scale to zero</th>
            <th className={subTable.th}>State</th>
            <th className={subTable.th} />
          </tr>
        </thead>
        <tbody>
          {np.endpoints.map((e) => (
            <EndpointRow key={e.id} project={p} np={np} e={e} infra={infra} endpointAction={endpoint} />
          ))}
        </tbody>
      </table>

      {(p.neonBranchUsage[np.id]?.length ?? 0) > 0 && (
        <div className={subTable.row}>
          <NeonBranchUsageTable rows={p.neonBranchUsage[np.id]} />
        </div>
      )}

      <div className={cn(subTable.row, "px-4 py-2.5")}>
        <QuotaSummary np={np} />
      </div>

      {showQuota && canManage && (
        <QuotaEditor project={p} np={np} infra={infra} onClose={() => setShowQuota(false)} />
      )}

      {branches.length > 0 && (
        <div className={cn(subTable.row, "flex flex-col gap-2 px-4 py-2.5")}>
          <p className="text-xs font-semibold text-os-muted">Branches</p>
          <div className="flex flex-wrap gap-1.5">
            {branches.map((b) => (
              <span
                key={b.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-os-container py-0.5 text-xs text-foreground",
                  canManage ? "pl-2.5 pr-1" : "px-2.5",
                )}
              >
                {b.name}
                {canManage && (
                  <Tooltip content="Delete branch">
                    <button
                      type="button"
                      disabled={infra.busy}
                      onClick={() => deleteBranch(b.id, b.name)}
                      aria-label={`Delete branch ${b.name}`}
                      className="rounded-full p-0.5 text-os-muted transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Tooltip>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EndpointRow({ project: p, np, e, infra, endpointAction }: { project: ProjectFleet; np: NeonProject; e: NeonEndpoint; infra: InfraApi; endpointAction: (e: NeonEndpoint, kind: "suspend" | "restart" | "start") => void }) {
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
      projectId: p.projectId,
      neonProjectId: np.id,
      endpointId: e.id,
      ...(minCu ? { minCu: Number(minCu) } : {}),
      ...(maxCu ? { maxCu: Number(maxCu) } : {}),
      ...(timeout ? { suspendTimeoutSeconds: Number(timeout) } : {}),
    });
  }

  return (
    <tr className={subTable.row}>
      <td className={cn(subTable.td, "truncate font-mono text-[13px] text-foreground")}>
        {e.id}
        <span className="ml-1.5 font-sans text-xs text-os-muted">{e.type}</span>
      </td>
      <td className={subTable.td}>
        <span className="inline-flex items-center gap-1 text-os-grey">
          <NumInput value={minCu} onChange={setMinCu} label={`${e.id} minimum CU`} />
          to
          <NumInput value={maxCu} onChange={setMaxCu} label={`${e.id} maximum CU`} /> CU
        </span>
      </td>
      <td className={subTable.td}>
        <span className="inline-flex items-center gap-1 text-os-grey">
          <NumInput value={timeout} onChange={setTimeoutS} width="w-16" label={`${e.id} suspend timeout in seconds`} /> s
        </span>
      </td>
      <td className={subTable.td}>
        <Pill tone={stateTone(e.currentState)}>{e.currentState}</Pill>
      </td>
      <td className={cn(subTable.td, "text-right")}>
        <div className="inline-flex justify-end gap-0.5">
          {dirty && (
            <IconAction label="Save autoscale" active disabled={infra.busy} onClick={saveAutoscale}>
              <Save className="h-4 w-4" />
            </IconAction>
          )}
          {e.currentState === "idle" ? (
            <IconAction label="Start" disabled={infra.busy} onClick={() => endpointAction(e, "start")}>
              <Play className="h-4 w-4" />
            </IconAction>
          ) : (
            <IconAction label="Suspend" disabled={infra.busy} onClick={() => endpointAction(e, "suspend")}>
              <Square className="h-4 w-4" />
            </IconAction>
          )}
          <IconAction label="Restart" disabled={infra.busy} onClick={() => endpointAction(e, "restart")}>
            <RotateCw className="h-4 w-4" />
          </IconAction>
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
  return <span className="text-xs text-os-grey">Limits: {parts.length ? parts.join(" · ") : "none (unlimited)"}</span>;
}

function QuotaEditor({ project: p, np, infra, onClose }: { project: ProjectFleet; np: NeonProject; infra: InfraApi; onClose: () => void }) {
  const dialog = useDialog();
  const { actionBtnPrimary } = useOsChrome();
  const [computeHours, setComputeHours] = useState(np.quota.computeTimeSeconds ? String(np.quota.computeTimeSeconds / 3600) : "");
  const [transferGb, setTransferGb] = useState(np.quota.dataTransferBytes ? String(np.quota.dataTransferBytes / 1e9) : "");
  const [sizeGb, setSizeGb] = useState(np.quota.logicalSizeBytes ? String(np.quota.logicalSizeBytes / 1e9) : "");

  async function save() {
    const ok = await dialog.confirm({
      title: "Set project limits?",
      tone: "destructive",
      confirmLabel: "Set limits",
      description:
        "When a usage limit is hit, Neon suspends this project's compute until the quota period resets. A normal connection will NOT wake it. Set 0 to leave unlimited.",
    });
    if (!ok) return;
    const quota: Record<string, number> = {};
    if (computeHours !== "") quota.compute_time_seconds = Math.round(Number(computeHours) * 3600);
    if (transferGb !== "") quota.data_transfer_bytes = Math.round(Number(transferGb) * 1e9);
    if (sizeGb !== "") quota.logical_size_bytes = Math.round(Number(sizeGb) * 1e9);
    if (Object.keys(quota).length === 0) return;
    infra.post({ intent: "neon.quota", projectId: p.projectId, neonProjectId: np.id, quota });
    onClose();
  }

  const field = "flex flex-col gap-1 text-xs text-os-grey";
  return (
    <div className={cn(subTable.row, "flex flex-wrap items-end gap-4 bg-os-amber/5 px-4 py-3")}>
      <label className={field}>
        Compute (h/mo)
        <NumInput value={computeHours} onChange={setComputeHours} width="w-20" />
      </label>
      <label className={field}>
        Egress (GB/mo)
        <NumInput value={transferGb} onChange={setTransferGb} width="w-20" />
      </label>
      <label className={field}>
        Branch size (GB)
        <NumInput value={sizeGb} onChange={setSizeGb} width="w-20" />
      </label>
      <button type="button" disabled={infra.busy} onClick={save} className={cn(actionBtnPrimary, "disabled:opacity-50")}>
        Save limits
      </button>
      <span className="text-xs text-os-muted">0 or blank means unlimited</span>
    </div>
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function Cleanup({ data, infra }: { data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const { panel } = useOsChrome();
  const items = data.cleanup;
  if (items.length === 0) {
    return (
      <div className={panel}>
        <EmptyState>Nothing idle to review.</EmptyState>
      </div>
    );
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
    const body: Record<string, unknown> = { intent: "reap", projectId: c.projectId, kind: c.kind };
    if (c.kind === "fly-app") body.app = c.resourceId;
    if (c.kind === "neon-branch") { body.neonProjectId = a; body.branchId = b; }
    if (c.kind === "neon-endpoint") { body.neonProjectId = a; body.endpointId = b; }
    infra.post(body);
  }

  return (
    <div className={adminTable.wrap}>
      <table className="w-full min-w-[760px]">
        <thead>
          <tr>
            <th className={adminTable.th}>Project</th>
            <th className={adminTable.th}>Resource</th>
            <th className={adminTable.th}>Detail</th>
            <th className={cn(adminTable.th, "text-right")}>Idle</th>
            <th className={cn(adminTable.th, "text-right")}>Age</th>
            <th className={adminTable.th} />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={`${c.projectId}:${c.kind}:${c.resourceId}`} className={adminTable.row}>
              <td className={cn(adminTable.td, "text-os-grey")}>{c.projectName}</td>
              <td className={adminTable.td}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] text-foreground">{c.name}</span>
                  <span className="text-xs text-os-muted">{c.kind}</span>
                  {c.protected && <Pill>Protected</Pill>}
                </span>
              </td>
              <td className={cn(adminTable.td, "text-os-grey")}>{c.detail}</td>
              <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>
                {c.idleDays != null ? `${c.idleDays}d` : "—"}
              </td>
              <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>
                {c.ageDays != null ? `${c.ageDays}d` : "—"}
              </td>
              <td className={cn(adminTable.td, "text-right")}>
                {data.isAdmin && !c.protected ? (
                  <IconAction label="Reap" danger disabled={infra.busy} onClick={() => reap(c)}>
                    <Trash2 className="h-4 w-4" />
                  </IconAction>
                ) : (
                  <span className="text-xs text-os-muted">{c.protected ? "Protected" : "Admin only"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Requests ──────────────────────────────────────────────────────────────────

function Requests({ data, infra }: { data: Data; infra: InfraApi }) {
  const dialog = useDialog();
  const { panel } = useOsChrome();
  const items = data.requests;
  if (items.length === 0) {
    return (
      <div className={panel}>
        <EmptyState>No pending requests.</EmptyState>
      </div>
    );
  }

  async function resolve(id: string, status: "Fulfilled" | "Rejected") {
    const note = await dialog.prompt({
      title: status === "Fulfilled" ? "Mark fulfilled" : "Reject request",
      label: "Note (optional)",
      confirmLabel: status === "Fulfilled" ? "Fulfilled" : "Reject",
    });
    if (note === null) return;
    infra.post({ intent: "resolve", requestId: id, status, note }, "/api/infra/request");
  }

  return (
    <ul className={panel}>
      {items.map((r, i) => (
        <li key={r.id} className={cn("flex items-start justify-between gap-4 px-6 py-4", i > 0 && "border-t border-os-container/70")}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{r.projectName}</span>
              <Pill>{infraRequestKindLabel(r.kind)}</Pill>
            </div>
            <p className="mt-1 text-sm text-foreground">{r.details}</p>
            {r.targetHint && <p className="mt-0.5 text-sm text-os-grey">Target: {r.targetHint}</p>}
            <p className="mt-1 text-xs text-os-muted">
              by {r.requestedByName} · {timeAgo(r.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            <IconAction label="Mark fulfilled" disabled={infra.busy} onClick={() => resolve(r.id, "Fulfilled")}>
              <Check className="h-4 w-4" />
            </IconAction>
            <IconAction label="Reject" danger disabled={infra.busy} onClick={() => resolve(r.id, "Rejected")}>
              <X className="h-4 w-4" />
            </IconAction>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────

function IconAction({
  label,
  children,
  onClick,
  disabled,
  danger,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  const { iconBtn } = useOsChrome();
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          iconBtn,
          "disabled:opacity-50",
          danger && "hover:bg-destructive/10 hover:text-destructive",
          active && "bg-os-accent/15 text-os-accent",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function NumInput({
  value,
  onChange,
  width = "w-14",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: string;
  label?: string;
}) {
  const { compactField } = useOsChrome();
  return (
    <input
      type="number"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={cn(compactField, width, "border border-os-container px-2 py-1 text-xs tabular-nums")}
    />
  );
}
