// Read-only per-project infrastructure view (Fly + Neon inventory + usage). Used
// in the project hub's Infrastructure section — no action controls (members view;
// Core acts from the fleet console, staffed members ask via requests). Usage
// only, with links out to each provider's billing.

import { ExternalLink } from "lucide-react";
import { VaultSection } from "./VaultSection";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import type { NeonQuota } from "~/lib/infra/types";
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
  StateBadge,
  UsageStrip,
  volumeSummary,
} from "./format";

export function ProjectInfraView({ project: p }: { project: ProjectFleet }) {
  const flyApps = p.fly?.apps ?? [];
  const neonProjects = p.neon?.projects ?? [];

  return (
    <div className="flex flex-col gap-4">
      <UsageStrip usage={p.usage} />

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {p.flyOrgSlug && (
          <a
            href={`https://fly.io/dashboard/${p.flyOrgSlug}/billing`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-os-accent hover:underline"
          >
            Fly billing <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {p.neonOrgId && (
          <a
            href={consoleUrl.neonOrg(p.neonOrgId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-os-accent hover:underline"
          >
            Neon billing <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <NeonCostLine plan={p.neonPlan} cost={p.neonCost} />
      </div>

      {/* Fly */}
      {p.flyOrgSlug && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fly</h4>
          {flyApps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No apps (or not swept yet).</p>
          ) : (
            <div className="space-y-2">
              {flyApps.map((app) => (
                <div key={app.name} className="rounded-md border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-foreground">{app.name}</span>
                      <ExternalIconLink href={consoleUrl.flyApp(app.name)} label="Open in Fly" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {app.status ?? ""} · {plural(app.machines.length, "machine")} · {volumeSummary(app.volumes)}
                    </span>
                  </div>
                  {app.machines.length > 0 && (
                    <table className="w-full table-fixed text-left text-xs">
                      <ColWidths widths={INFRA_COLS.view} />
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1 font-medium">Machine</th>
                          <th className="px-3 py-1 font-medium">Size</th>
                          <th className="px-3 py-1 font-medium">Region</th>
                          <th className="px-3 py-1 font-medium">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {app.machines.map((m) => (
                          <tr key={m.id} className="border-t border-border">
                            <td className="px-3 py-1.5 font-mono text-foreground">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{m.name || m.id}</span>
                                <ExternalIconLink href={consoleUrl.flyMachine(app.name, m.id)} label="Open machine in Fly" />
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {m.cpuKind} {m.cpus}x · {fmtBytes(m.memoryMb * 1024 * 1024)}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">{m.region}</td>
                            <td className="px-3 py-1.5">
                              <StateBadge state={m.state} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Neon */}
      {p.neonOrgId && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Neon</h4>
          {neonProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {p.neonProjectIds.length === 0
                ? "No Neon databases linked to this project yet."
                : "No databases (or not swept yet)."}
            </p>
          ) : (
            <div className="space-y-2">
              {neonProjects.map((np) => (
                <div key={np.id} className="rounded-md border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-foreground">{np.name}</span>
                      <ExternalIconLink href={consoleUrl.neonProject(np.id)} label="Open in Neon" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {np.regionId} · pg{np.pgVersion ?? "?"} · {plural(np.branches.length, "branch", "branches")}
                      {p.neonCost?.byProject[np.id] != null && ` · est. ${fmtUsd(p.neonCost.byProject[np.id])} this month`}
                    </span>
                  </div>
                  <table className="w-full table-fixed text-left text-xs">
                    <ColWidths widths={INFRA_COLS.view} />
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1 font-medium">Compute</th>
                        <th className="px-3 py-1 font-medium">Autoscale</th>
                        <th className="px-3 py-1 font-medium">Scale-to-zero</th>
                        <th className="px-3 py-1 font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {np.endpoints.map((e) => (
                        <tr key={e.id} className="border-t border-border">
                          <td className="truncate px-3 py-1.5 font-mono text-foreground">
                            {e.id}
                            <span className="ml-1 text-[10px] text-muted-foreground">{e.type}</span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {e.autoscalingMinCu ?? "?"}–{e.autoscalingMaxCu ?? "?"} CU
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {e.suspendTimeoutSeconds != null ? `${e.suspendTimeoutSeconds}s` : "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            <StateBadge state={e.currentState} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(p.neonBranchUsage[np.id]?.length ?? 0) > 0 && (
                    <div className="border-t border-border">
                      <NeonBranchUsageTable rows={p.neonBranchUsage[np.id]} />
                    </div>
                  )}
                  <div className="border-t border-border px-3 py-1.5">
                    <QuotaSummary quota={np.quota} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {p.vault && <VaultSection vault={p.vault} membersUrl={p.vaultMembersUrl} />}
      {p.vaultwardenGroupId && !p.vault && (
        <p className="text-xs text-muted-foreground">Vaultwarden group linked. Check back after the next sweep.</p>
      )}
    </div>
  );
}

function QuotaSummary({ quota: q }: { quota: NeonQuota }) {
  const parts: string[] = [];
  if (q.computeTimeSeconds) parts.push(`compute ${fmtHours(q.computeTimeSeconds)}`);
  if (q.activeTimeSeconds) parts.push(`active ${fmtHours(q.activeTimeSeconds)}`);
  if (q.writtenDataBytes) parts.push(`written ${fmtBytes(q.writtenDataBytes)}`);
  if (q.dataTransferBytes) parts.push(`egress ${fmtBytes(q.dataTransferBytes)}`);
  if (q.logicalSizeBytes) parts.push(`size ${fmtBytes(q.logicalSizeBytes)}`);
  return (
    <span className="text-[11px] text-muted-foreground">
      Limits: {parts.length ? parts.join(" · ") : "none (unlimited)"}
    </span>
  );
}
