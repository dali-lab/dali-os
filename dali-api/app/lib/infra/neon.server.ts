// Neon API adapter (https://console.neon.tech/api/v2). One shared personal key
// (INFRA_NEON_API_KEY) spans all orgs; org_id is passed per call from the registry.
// Deliberately its OWN env var, distinct from CI's NEON_API_KEY (a GitHub Actions
// secret): the dashboard is a long-running app holding a broad org-wide admin key,
// so it rotates and audits separately from preview-deploy tooling.
// Auth: `Authorization: Bearer <INFRA_NEON_API_KEY>`. Writes return operations[] that
// callers may poll to completion (see pollOperations). This module never logs
// connection strings or role passwords the API returns.

import type {
  NeonBranch,
  NeonEndpoint,
  NeonInventory,
  NeonProject,
  NeonQuota,
} from "./types";

const NEON_API = "https://console.neon.tech/api/v2";

export function neonConfigured(): boolean {
  return Boolean(process.env.INFRA_NEON_API_KEY);
}

function neonKey(): string {
  const k = process.env.INFRA_NEON_API_KEY;
  if (!k) throw new Error("INFRA_NEON_API_KEY is not set");
  return k;
}

export class NeonApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NeonApiError";
    this.status = status;
  }
}

async function neonFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${neonKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NeonApiError(res.status, `Neon API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ── Reads ────────────────────────────────────────────────────────────────────

type RawProject = {
  id?: string;
  name?: string;
  region_id?: string;
  pg_version?: number;
  created_at?: string;
  settings?: { quota?: Record<string, number> };
};

function normalizeQuota(q?: Record<string, number>): NeonQuota {
  const v = (k: string) => (typeof q?.[k] === "number" && q[k] > 0 ? q[k] : null);
  return {
    activeTimeSeconds: v("active_time_seconds"),
    computeTimeSeconds: v("compute_time_seconds"),
    writtenDataBytes: v("written_data_bytes"),
    dataTransferBytes: v("data_transfer_bytes"),
    logicalSizeBytes: v("logical_size_bytes"),
  };
}

export async function listProjects(orgId: string): Promise<RawProject[]> {
  const res = (await neonFetch(
    `/projects?org_id=${encodeURIComponent(orgId)}&limit=400`,
  )) as { projects?: RawProject[] } | null;
  return res?.projects ?? [];
}

export async function listBranches(projectId: string): Promise<NeonBranch[]> {
  const res = (await neonFetch(
    `/projects/${encodeURIComponent(projectId)}/branches`,
  )) as {
    branches?: {
      id?: string;
      name?: string;
      parent_id?: string;
      created_at?: string;
      default?: boolean;
    }[];
  } | null;
  return (res?.branches ?? []).map((b) => ({
    id: b.id ?? "",
    name: b.name ?? "",
    parentId: b.parent_id ?? null,
    createdAt: b.created_at ?? null,
    default: !!b.default,
  }));
}

export async function listEndpoints(projectId: string): Promise<NeonEndpoint[]> {
  const res = (await neonFetch(
    `/projects/${encodeURIComponent(projectId)}/endpoints`,
  )) as {
    endpoints?: {
      id?: string;
      branch_id?: string;
      type?: string;
      current_state?: string;
      autoscaling_limit_min_cu?: number;
      autoscaling_limit_max_cu?: number;
      suspend_timeout_seconds?: number;
      last_active?: string;
    }[];
  } | null;
  return (res?.endpoints ?? []).map((e) => ({
    id: e.id ?? "",
    branchId: e.branch_id ?? "",
    type: e.type ?? "",
    currentState: e.current_state ?? "",
    autoscalingMinCu: e.autoscaling_limit_min_cu ?? null,
    autoscalingMaxCu: e.autoscaling_limit_max_cu ?? null,
    suspendTimeoutSeconds: e.suspend_timeout_seconds ?? null,
    lastActive: e.last_active ?? null,
  }));
}

// Full read sweep for one org: plan + projects + their branches + endpoints.
export async function getNeonInventory(orgId: string): Promise<NeonInventory> {
  const [projects, plan] = await Promise.all([
    listProjects(orgId),
    getOrganizationPlan(orgId).catch(() => null),
  ]);
  const detailed: NeonProject[] = [];
  for (const p of projects) {
    const id = p.id ?? "";
    if (!id) continue;
    const [branches, endpoints] = await Promise.all([
      listBranches(id).catch(() => [] as NeonBranch[]),
      listEndpoints(id).catch(() => [] as NeonEndpoint[]),
    ]);
    detailed.push({
      id,
      name: p.name ?? id,
      regionId: p.region_id ?? "",
      pgVersion: p.pg_version ?? null,
      createdAt: p.created_at ?? null,
      quota: normalizeQuota(p.settings?.quota),
      branches,
      endpoints,
    });
  }
  return { orgId, plan, projects: detailed };
}

// ── Consumption ──────────────────────────────────────────────────────────────

export const NEON_PROJECT_METRICS = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
  "instant_restore_bytes_month",
  "snapshot_storage_bytes_month",
  "public_network_transfer_bytes",
  "private_network_transfer_bytes",
  "extra_branches_month",
] as const;

// The branch endpoint rejects the two project-only metrics.
export const NEON_BRANCH_METRICS = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
  "instant_restore_bytes_month",
  "public_network_transfer_bytes",
  "private_network_transfer_bytes",
] as const;

export type NeonConsumptionSample = {
  projectId: string;
  branchId: string | null;
  metric: string;
  value: number;
  /** Start of the granularity bucket (day or month). */
  at: string;
  plan: string | null;
};

type RawConsumption = {
  project_id?: string;
  branch_id?: string;
  periods?: {
    period_plan?: string;
    period_start?: string;
    consumption?: {
      timeframe_start?: string;
      metrics?: { metric_name?: string; value?: number }[];
    }[];
  }[];
};

const MAX_CONSUMPTION_PAGES = 10;

export function flattenConsumption(rows: RawConsumption[]): NeonConsumptionSample[] {
  const out: NeonConsumptionSample[] = [];
  for (const r of rows) {
    for (const period of r.periods ?? []) {
      for (const c of period.consumption ?? []) {
        const at = c.timeframe_start ?? period.period_start ?? "";
        for (const m of c.metrics ?? []) {
          if (!m.metric_name || !at) continue;
          out.push({
            projectId: r.project_id ?? "",
            branchId: r.branch_id ?? null,
            metric: m.metric_name,
            value: Number(m.value ?? 0),
            at,
            plan: period.period_plan ?? null,
          });
        }
      }
    }
  }
  return out;
}

// Raw usage (CU-seconds, byte-months, bytes, branch-hours). Paid-plan gated on
// Neon's side (403 otherwise); callers swallow failures as "no usage". Shares a
// ~50 req/min account limiter, so pages are bounded.
export async function getConsumption(opts: {
  orgId: string;
  scope: "projects" | "branches";
  granularity: "daily" | "monthly";
  from: string;
  to: string;
  projectIds?: string[];
}): Promise<NeonConsumptionSample[]> {
  const metrics = opts.scope === "projects" ? NEON_PROJECT_METRICS : NEON_BRANCH_METRICS;
  const base =
    `?org_id=${encodeURIComponent(opts.orgId)}` +
    `&from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}` +
    `&granularity=${opts.granularity}&limit=100` +
    `&metrics=${metrics.join(",")}` +
    (opts.projectIds?.length ? `&project_ids=${opts.projectIds.map(encodeURIComponent).join(",")}` : "");
  const rows: RawConsumption[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONSUMPTION_PAGES; page++) {
    const res = (await neonFetch(
      `/consumption_history/v2/${opts.scope}${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    )) as { projects?: RawConsumption[]; branches?: RawConsumption[]; pagination?: { cursor?: string } } | null;
    const pageRows = (opts.scope === "projects" ? res?.projects : res?.branches) ?? [];
    rows.push(...pageRows);
    const next = res?.pagination?.cursor;
    if (!next || next === cursor || pageRows.length === 0) break;
    cursor = next;
  }
  return flattenConsumption(rows);
}

export async function getOrganizationPlan(orgId: string): Promise<string | null> {
  const res = (await neonFetch(`/organizations/${encodeURIComponent(orgId)}`)) as {
    plan?: string;
  } | null;
  return res?.plan ?? null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type NeonOp = { id?: string; status?: string };

async function neonWrite(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ operations: NeonOp[]; raw: unknown }> {
  const raw = await neonFetch(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const operations = ((raw as { operations?: NeonOp[] } | null)?.operations ?? []) as NeonOp[];
  return { operations, raw };
}

const TERMINAL = new Set(["finished", "skipped", "failed", "error", "cancelled"]);

// Poll operations to a terminal state. Bounded — dashboard actions shouldn't
// hang; if ops don't settle in time we return and let the next sweep reflect
// reality.
export async function pollOperations(
  projectId: string,
  ops: NeonOp[],
  timeoutMs = 20000,
): Promise<void> {
  const pending = new Set(ops.map((o) => o.id).filter((x): x is string => !!x));
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const id of [...pending]) {
      const res = (await neonFetch(
        `/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(id)}`,
      ).catch(() => null)) as { operation?: NeonOp } | null;
      const status = res?.operation?.status;
      if (status && TERMINAL.has(status)) pending.delete(id);
    }
  }
}

export async function updateEndpoint(
  projectId: string,
  endpointId: string,
  patch: {
    autoscaling_limit_min_cu?: number;
    autoscaling_limit_max_cu?: number;
    suspend_timeout_seconds?: number;
  },
): Promise<NeonOp[]> {
  const { operations } = await neonWrite(
    `/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(endpointId)}`,
    "PATCH",
    { endpoint: patch },
  );
  return operations;
}

export type NeonEndpointActionKind = "suspend" | "restart" | "start";

export async function endpointAction(
  projectId: string,
  endpointId: string,
  kind: NeonEndpointActionKind,
): Promise<NeonOp[]> {
  const { operations } = await neonWrite(
    `/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(endpointId)}/${kind}`,
    "POST",
  );
  return operations;
}

export type NeonQuotaPatch = Partial<{
  active_time_seconds: number;
  compute_time_seconds: number;
  written_data_bytes: number;
  data_transfer_bytes: number;
  logical_size_bytes: number;
}>;

// Set (or clear) project quotas. 0 = unlimited / clears a limit. Omitted fields
// are left unchanged. WARNING (caller UX): hitting a period quota suspends the
// project's compute until the next billing period.
export async function setProjectQuota(projectId: string, quota: NeonQuotaPatch): Promise<void> {
  await neonWrite(`/projects/${encodeURIComponent(projectId)}`, "PATCH", {
    project: { settings: { quota } },
  });
}

// Default compute range for databases made from DALI OS: student projects
// rarely need more, and it bounds the worst-case compute bill. Raise per
// database from the console.
export const NEW_PROJECT_COMPUTE = { minCu: 0.25, maxCu: 2 };

// The response carries connection URIs and role passwords; only the project
// id is read from it, and it is never logged.
export async function createProject(
  orgId: string,
  name: string,
): Promise<{ projectId: string | null; operations: NeonOp[] }> {
  const { raw, operations } = await neonWrite(`/projects`, "POST", {
    project: {
      name,
      org_id: orgId,
      default_endpoint_settings: {
        autoscaling_limit_min_cu: NEW_PROJECT_COMPUTE.minCu,
        autoscaling_limit_max_cu: NEW_PROJECT_COMPUTE.maxCu,
      },
    },
  });
  const projectId = (raw as { project?: { id?: string } } | null)?.project?.id ?? null;
  return { projectId, operations };
}

export async function deleteProject(projectId: string): Promise<void> {
  await neonWrite(`/projects/${encodeURIComponent(projectId)}`, "DELETE");
}

export async function deleteBranch(projectId: string, branchId: string): Promise<NeonOp[]> {
  const { operations } = await neonWrite(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    "DELETE",
  );
  return operations;
}
