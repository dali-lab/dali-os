// Sweeps every enabled InfraProject's Fly + Neon accounts and caches the result
// so the Infrastructure dashboard renders from Postgres (instant, rate-limit
// safe). Writes one latest-wins InfraSnapshot per (project, provider) plus usage
// samples (Neon consumption + best-effort Fly egress). Idempotent and bounded;
// a no-op when no projects are registered. Projects share one Neon org, so each
// org is fetched once per run; each project's snapshot keeps the whole org (its
// database picker needs it) and its usage rows cover only its linked databases.
// Neon daily rows re-read the full 60-day window once per UTC day and only the
// last two days on other runs, which keeps hourly runs to a few hundred upserts.

import type { JobContext, JobResult } from "~/jobs/registry";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import {
  getProjectInfraCreds,
  listEnabledInfraProjectCreds,
  type InfraProjectCreds,
} from "~/lib/infra/project-infra.server";
import { getFlyEgressByApp, getFlyInventory, getFlyMachineHoursByApp } from "~/lib/infra/fly.server";
import {
  getConsumption,
  getNeonInventory,
  neonConfigured,
  type NeonConsumptionSample,
} from "~/lib/infra/neon.server";
import { monthStart } from "~/lib/infra/neon-cost";
import { branchScopeId, SCOPE } from "~/lib/infra/neon-scope";
import type { NeonInventory } from "~/lib/infra/types";

type UsageRow = {
  provider: "fly" | "neon";
  scopeType: string;
  scopeId: string;
  scopeName: string;
  metric: string;
  value: number;
  at: Date;
};

const DAY_MS = 86_400_000;
const NEON_DAILY_DAYS = 60;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function neonDailyFrom(ctx: JobContext): Date {
  const today = startOfUtcDay(ctx.now);
  const fullRefresh = !ctx.lastSuccessAt || startOfUtcDay(ctx.lastSuccessAt).getTime() !== today.getTime();
  const earliest = new Date(today.getTime() - (NEON_DAILY_DAYS - 1) * DAY_MS);
  if (!fullRefresh) return new Date(today.getTime() - DAY_MS);
  const lastMonth = monthStart(ctx.now, -1);
  return lastMonth > earliest ? lastMonth : earliest;
}

type NeonOrgUsage = {
  daily: NeonConsumptionSample[];
  monthly: NeonConsumptionSample[];
  branches: NeonConsumptionSample[];
};

// Each read fails on its own (403 off paid plans, 429 under load) so one
// missing series doesn't blank the others.
async function loadNeonOrgUsage(orgId: string, inv: NeonInventory, ctx: JobContext): Promise<NeonOrgUsage> {
  const to = ctx.now.toISOString();
  const quiet = (p: Promise<NeonConsumptionSample[]>) => p.catch(() => [] as NeonConsumptionSample[]);
  const daily = await quiet(
    getConsumption({ orgId, scope: "projects", granularity: "daily", from: neonDailyFrom(ctx).toISOString(), to }),
  );
  const monthly = await quiet(
    getConsumption({ orgId, scope: "projects", granularity: "monthly", from: monthStart(ctx.now, -1).toISOString(), to }),
  );
  const ids = inv.projects.map((p) => p.id);
  const branches: NeonConsumptionSample[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    branches.push(
      ...(await quiet(
        getConsumption({
          orgId,
          scope: "branches",
          granularity: "monthly",
          from: monthStart(ctx.now).toISOString(),
          to,
          projectIds: ids.slice(i, i + 100),
        }),
      )),
    );
  }
  return { daily, monthly, branches };
}

function neonUsageRows(usage: NeonOrgUsage, inv: NeonInventory, linked: Set<string>): UsageRow[] {
  const projectName = new Map(inv.projects.map((p) => [p.id, p.name]));
  const branchName = new Map(
    inv.projects.flatMap((p) => p.branches.map((b) => [branchScopeId(p.id, b.id), `${p.name} / ${b.name}`] as const)),
  );
  const row = (c: NeonConsumptionSample, scopeType: string, scopeId: string, scopeName: string): UsageRow => ({
    provider: "neon",
    scopeType,
    scopeId,
    scopeName,
    metric: c.metric,
    value: c.value,
    at: new Date(c.at),
  });
  const mine = (list: NeonConsumptionSample[]) => list.filter((c) => linked.has(c.projectId));
  return [
    ...mine(usage.daily).map((c) => row(c, SCOPE.neonDaily, c.projectId, projectName.get(c.projectId) ?? c.projectId)),
    ...mine(usage.monthly).map((c) => row(c, SCOPE.neonMonth, c.projectId, projectName.get(c.projectId) ?? c.projectId)),
    ...mine(usage.branches)
      .filter((c) => c.branchId)
      .map((c) => {
        const id = branchScopeId(c.projectId, c.branchId!);
        return row(c, SCOPE.neonBranchMonth, id, branchName.get(id) ?? id);
      }),
  ];
}

// Latest-wins: write the new snapshot, then drop older ones for the same
// (project, provider) so the render always reads exactly one current row.
async function writeSnapshot(
  projectId: string,
  provider: "fly" | "neon",
  payload: unknown,
): Promise<void> {
  const snap = await prisma.infraSnapshot.create({
    data: { projectId, provider, payload: payload as Prisma.InputJsonValue },
  });
  await prisma.infraSnapshot.deleteMany({
    where: { projectId, provider, id: { not: snap.id } },
  });
}

// Upsert one usage sample. Neon monthly rows share an `at` (period start) across
// a month, so month-to-date growth updates the value; Fly egress rows carry the
// sweep time and accumulate as a per-run time series.
async function upsertUsage(projectId: string, r: UsageRow): Promise<void> {
  await prisma.infraUsageSample.upsert({
    where: {
      provider_scopeType_scopeId_metric_at: {
        provider: r.provider,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        metric: r.metric,
        at: r.at,
      },
    },
    create: { projectId, ...r },
    update: { projectId, value: r.value, scopeName: r.scopeName },
  });
}

export async function runInfraSnapshot(ctx: JobContext): Promise<JobResult> {
  const projects = await listEnabledInfraProjectCreds();
  if (projects.length === 0) return { items: 0, note: "no registered projects" };
  return sweepProjects(projects, ctx);
}

// After a project's infra config is saved: copy another project's latest sweep
// of the same Neon org (so its databases show at once), then sweep this project
// in the background for its own usage. Never throws into the save.
export async function refreshProjectInfra(projectId: string): Promise<void> {
  const creds = await getProjectInfraCreds(projectId);
  if (!creds?.infraEnabled) return;
  if (creds.neonOrgId) await adoptNeonOrgSnapshot(projectId, creds.neonOrgId).catch(() => {});
  void sweepProjects([creds], { now: new Date(), lastSuccessAt: null, settings: {} }).catch((err) =>
    console.error("infra refresh failed", projectId, err instanceof Error ? err.message : err),
  );
}

export async function adoptNeonOrgSnapshot(projectId: string, orgId: string): Promise<boolean> {
  const snaps = await prisma.infraSnapshot.findMany({
    where: { provider: "neon" },
    orderBy: { fetchedAt: "desc" },
    select: { projectId: true, payload: true },
  });
  const own = snaps.find((s) => s.projectId === projectId);
  if ((own?.payload as NeonInventory | null)?.orgId === orgId) return false;
  const donor = snaps.find((s) => s.projectId !== projectId && (s.payload as NeonInventory | null)?.orgId === orgId);
  if (!donor) return false;
  await writeSnapshot(projectId, "neon", donor.payload);
  return true;
}

async function sweepProjects(projects: InfraProjectCreds[], ctx: JobContext): Promise<JobResult> {
  let providersSwept = 0;
  let usageCount = 0;
  const neonInventories = new Map<string, Promise<NeonInventory>>();
  const neonUsage = new Map<string, Promise<NeonOrgUsage>>();
  const once = <T,>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key)!;
  };

  for (const p of projects) {
    // ── Fly ──
    if (p.flyOrgSlug && p.flyReadToken) {
      try {
        const inv = await getFlyInventory(p.flyReadToken, p.flyOrgSlug);
        await writeSnapshot(p.projectId, "fly", inv);
        providersSwept++;
        try {
          const egress = await getFlyEgressByApp(p.flyReadToken, p.flyOrgSlug);
          for (const e of egress) {
            await upsertUsage(p.projectId, {
              provider: "fly",
              scopeType: SCOPE.flyApp,
              scopeId: e.appName,
              scopeName: e.appName,
              metric: "egress_bytes",
              value: e.egressBytes,
              at: ctx.now,
            });
            usageCount++;
          }
        } catch {
          // Prometheus is optional; inventory still rendered.
        }
        try {
          for (const m of await getFlyMachineHoursByApp(p.flyReadToken, p.flyOrgSlug)) {
            await upsertUsage(p.projectId, {
              provider: "fly",
              scopeType: SCOPE.flyApp,
              scopeId: m.appName,
              scopeName: m.appName,
              metric: "machine_hours_24h",
              value: m.machineHours,
              at: ctx.now,
            });
            usageCount++;
          }
        } catch {
          // Same as egress.
        }
      } catch (err) {
        console.error(
          "infra-snapshot fly sweep failed",
          p.projectId,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Neon ──
    if (p.neonOrgId && neonConfigured()) {
      try {
        const orgId = p.neonOrgId;
        const inv = await once(neonInventories, orgId, () => getNeonInventory(orgId));
        await writeSnapshot(p.projectId, "neon", inv);
        providersSwept++;
        const usage = await once(neonUsage, orgId, () => loadNeonOrgUsage(orgId, inv, ctx));
        for (const r of neonUsageRows(usage, inv, new Set(p.neonProjectIds))) {
          await upsertUsage(p.projectId, r);
          usageCount++;
        }
      } catch (err) {
        console.error(
          "infra-snapshot neon sweep failed",
          p.projectId,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    items: providersSwept,
    note: `${projects.length} projects · ${usageCount} usage samples`,
  };
}
