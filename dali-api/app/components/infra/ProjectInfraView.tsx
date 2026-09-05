// Read-only per-project infrastructure view (Fly + Neon inventory + usage). Used
// in the project hub's Infrastructure section — no action controls (members view;
// Core acts from the fleet console, staffed members ask via requests). Usage
// only, with links out to each provider's billing.

import { ExternalLink } from "lucide-react";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import type { NeonQuota } from "~/lib/infra/types";
import { fmtBytes, fmtHours, StateBadge, UsageStrip } from "./format";

export function ProjectInfraView({ project: p }: { project: ProjectFleet }) {
  const flyApps = p.fly?.apps ?? [];
  const neonProjects = p.neon?.projects ?? [];

  return (
    <div className="flex flex-col gap-4">
      <UsageStrip usage={p.usage} />

      <div className="flex flex-wrap gap-3 text-xs">
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
        <span className="text-zinc-400">Usage figures only — see billing for cost.</span>
      </div>

      {/* Fly */}
      {p.flyOrgSlug && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Fly</h4>
          {flyApps.length === 0 ? (
            <p className="text-xs text-zinc-400">No apps (or not swept yet).</p>
          ) : (
            <div className="space-y-2">
              {flyApps.map((app) => (
                <div key={app.name} className="rounded-md border border-zinc-200">
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5">
                    <span className="font-mono text-xs font-medium text-zinc-800">{app.name}</span>
                    <span className="text-[11px] text-zinc-500">
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
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Neon</h4>
          {neonProjects.length === 0 ? (
            <p className="text-xs text-zinc-400">No databases (or not swept yet).</p>
          ) : (
            <div className="space-y-2">
              {neonProjects.map((np) => (
                <div key={np.id} className="rounded-md border border-zinc-200">
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5">
                    <span className="font-mono text-xs font-medium text-zinc-800">{np.name}</span>
                    <span className="text-[11px] text-zinc-500">
                      {np.regionId} · pg{np.pgVersion ?? "?"} · {np.branches.length} branches
                    </span>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="text-zinc-400">
                      <tr>
                        <th className="px-3 py-1 font-medium">Compute</th>
                        <th className="px-3 py-1 font-medium">Autoscale</th>
                        <th className="px-3 py-1 font-medium">Scale-to-zero</th>
                        <th className="px-3 py-1 font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {np.endpoints.map((e) => (
                        <tr key={e.id} className="border-t border-zinc-50">
                          <td className="px-3 py-1.5 font-mono text-zinc-700">
                            {e.id}
                            <span className="ml-1 text-[10px] text-zinc-400">{e.type}</span>
                          </td>
                          <td className="px-3 py-1.5 text-zinc-600">
                            {e.autoscalingMinCu ?? "?"}–{e.autoscalingMaxCu ?? "?"} CU
                          </td>
                          <td className="px-3 py-1.5 text-zinc-600">
                            {e.suspendTimeoutSeconds != null ? `${e.suspendTimeoutSeconds}s` : "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            <StateBadge state={e.currentState} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-zinc-100 px-3 py-1.5">
                    <QuotaSummary quota={np.quota} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
    <span className="text-[11px] text-zinc-500">
      Limits: {parts.length ? parts.join(" · ") : "none (unlimited)"}
    </span>
  );
}
