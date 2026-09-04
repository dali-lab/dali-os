// Sweeps every enabled InfraProject's Fly + Neon accounts and caches the result
// so the Infrastructure dashboard renders from Postgres (instant, rate-limit
// safe). Writes one latest-wins InfraSnapshot per (project, provider) plus usage
// samples (Neon consumption + best-effort Fly egress). Idempotent and bounded;
// a no-op when no projects are registered.

import type { JobContext, JobResult } from "~/jobs/registry";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { listEnabledInfraProjectCreds } from "~/lib/infra/registry.server";
import { getFlyEgressByApp, getFlyInventory } from "~/lib/infra/fly.server";
import { getConsumption, getNeonInventory, neonConfigured } from "~/lib/infra/neon.server";

type UsageRow = {
  provider: "fly" | "neon";
  scopeType: string;
  scopeId: string;
  scopeName: string;
  metric: string;
  value: number;
  at: Date;
};

function monthWindow(now: Date): { from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: start.toISOString(), to: end.toISOString() };
}

// Latest-wins: write the new snapshot, then drop older ones for the same
// (project, provider) so the render always reads exactly one current row.
async function writeSnapshot(
  projectKey: string,
  provider: "fly" | "neon",
  payload: unknown,
): Promise<void> {
  const snap = await prisma.infraSnapshot.create({
    data: { projectKey, provider, payload: payload as Prisma.InputJsonValue },
  });
  await prisma.infraSnapshot.deleteMany({
    where: { projectKey, provider, id: { not: snap.id } },
  });
}

// Upsert one usage sample. Neon monthly rows share an `at` (period start) across
// a month, so month-to-date growth updates the value; Fly egress rows carry the
// sweep time and accumulate as a per-run time series.
async function upsertUsage(projectKey: string, r: UsageRow): Promise<void> {
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
    create: { projectKey, ...r },
    update: { value: r.value, scopeName: r.scopeName },
  });
}

export async function runInfraSnapshot(ctx: JobContext): Promise<JobResult> {
  const projects = await listEnabledInfraProjectCreds();
  if (projects.length === 0) return { items: 0, note: "no registered projects" };

  const { from, to } = monthWindow(ctx.now);
  let providersSwept = 0;
  let usageCount = 0;

  for (const p of projects) {
    // ── Fly ──
    if (p.flyOrgSlug && p.flyReadToken) {
      try {
        const inv = await getFlyInventory(p.flyReadToken, p.flyOrgSlug);
        await writeSnapshot(p.key, "fly", inv);
        providersSwept++;
        try {
          const egress = await getFlyEgressByApp(p.flyReadToken, p.flyOrgSlug);
          for (const e of egress) {
            await upsertUsage(p.key, {
              provider: "fly",
              scopeType: "fly-app",
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
      } catch (err) {
        console.error(
          "infra-snapshot fly sweep failed",
          p.key,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Neon ──
    if (p.neonOrgId && neonConfigured()) {
      try {
        const inv = await getNeonInventory(p.neonOrgId);
        await writeSnapshot(p.key, "neon", inv);
        providersSwept++;
        try {
          const consumption = await getConsumption(p.neonOrgId, from, to);
          const nameById = new Map(inv.projects.map((pr) => [pr.id, pr.name]));
          for (const c of consumption) {
            await upsertUsage(p.key, {
              provider: "neon",
              scopeType: "neon-project",
              scopeId: c.projectId,
              scopeName: nameById.get(c.projectId) ?? c.projectId,
              metric: c.metric,
              value: c.value,
              at: new Date(c.periodStart || ctx.now.toISOString()),
            });
            usageCount++;
          }
        } catch {
          // Consumption is paid-plan gated; inventory still rendered.
        }
      } catch (err) {
        console.error(
          "infra-snapshot neon sweep failed",
          p.key,
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
