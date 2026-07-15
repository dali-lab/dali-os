// Admin → Jobs. Status + controls for the background job runner
// (app/jobs/runner.server.ts): per-job enable toggle and a "Run now" that
// force-runs through the same claim path as the scheduler.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { Play } from "lucide-react";
import type { Route } from "./+types/admin-console.jobs";
import { adminPills } from "~/admin-console/adminPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { JOBS } from "~/jobs/registry";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Jobs · Admin · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const rows = await prisma.scheduledJob.findMany();
  const rowByName = new Map(rows.map((r) => [r.name, r]));

  // The registry is the source of truth for which jobs exist and what they
  // do; the row carries runtime state. A job with no row yet (fresh DB,
  // runner hasn't ticked) still renders, with empty state.
  const jobs = JOBS.map((def) => {
    const row = rowByName.get(def.name);
    return {
      name: def.name,
      description: def.description,
      intervalMinutes: def.intervalMinutes,
      enabled: row?.enabled ?? true,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastError: row?.lastError ?? null,
      lastDurationMs: row?.lastDurationMs ?? null,
    };
  });

  return { jobs };
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type JobView = {
  name: string;
  description: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "Success" | "Error" | null;
  lastError: string | null;
  lastDurationMs: number | null;
};

function JobRow({ job }: { job: JobView }) {
  const toggleFetcher = useFetcher();
  const runFetcher = useFetcher();
  const revalidator = useRevalidator();
  const busy = toggleFetcher.state !== "idle" || runFetcher.state !== "idle";

  // Refresh the table once a Run-now round-trip finishes so lastRunAt/status
  // reflect the run without a manual reload.
  useEffect(() => {
    if (runFetcher.state === "idle" && runFetcher.data) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetcher.state]);

  const enabled =
    toggleFetcher.formData != null
      ? toggleFetcher.formData.get("enabled") === "true"
      : job.enabled;

  return (
    <tr className="border-b border-zinc-100 last:border-b-0">
      <td className="px-3 py-3 align-top">
        <p className="font-mono text-sm font-medium text-zinc-900">{job.name}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{job.description}</p>
        {job.lastError && (
          <p className="mt-1 break-all text-xs text-red-600" title={job.lastError}>
            {job.lastError.length > 200 ? `${job.lastError.slice(0, 200)}…` : job.lastError}
          </p>
        )}
      </td>
      <td className="px-3 py-3 text-center align-top text-xs text-zinc-600">
        {job.intervalMinutes}m
      </td>
      <td className="px-3 py-3 text-center align-top">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            toggleFetcher.submit(
              { enabled: !enabled },
              {
                method: "PATCH",
                action: `/api/jobs/${job.name}`,
                encType: "application/json",
              },
            )
          }
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            enabled
              ? "bg-green-100 text-green-800 hover:bg-green-200"
              : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
          } disabled:opacity-50`}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </td>
      <td className="px-3 py-3 text-center align-top text-xs text-zinc-600">
        {formatTime(job.nextRunAt)}
      </td>
      <td className="px-3 py-3 text-center align-top text-xs text-zinc-600">
        <div>{formatTime(job.lastRunAt)}</div>
        {job.lastStatus && (
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              job.lastStatus === "Success"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {job.lastStatus}
            {job.lastDurationMs != null && ` · ${job.lastDurationMs}ms`}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-center align-top">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            runFetcher.submit(
              { action: "run" },
              {
                method: "POST",
                action: `/api/jobs/${job.name}`,
                encType: "application/json",
              },
            )
          }
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          {runFetcher.state !== "idle" ? "Running…" : "Run now"}
        </button>
      </td>
    </tr>
  );
}

export default function AdminJobs() {
  const { jobs } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={adminPills({ isAdmin: true, active: "jobs" })} />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Background jobs run on a one-minute tick. Disable a job to pause it;
          "Run now" executes it immediately (it won't overlap an in-flight run).
        </p>
      </header>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2 text-center">Interval</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-center">Next run</th>
              <th className="px-3 py-2 text-center">Last run</th>
              <th className="px-3 py-2 text-center" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <JobRow key={job.name} job={job} />
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-zinc-500">
                  No jobs registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
