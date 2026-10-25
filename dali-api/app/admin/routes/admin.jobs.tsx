// Admin → Platform → Jobs. Status + controls for the background job runner
// (app/jobs/runner.server.ts): per-job enable toggle, "Run now" (force, but
// never overlapping an in-flight run), and the operator-editable knobs —
// interval and any settings the job's registry entry declares. The row is
// authoritative at runtime; the registry values shown are just the defaults.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { useDialog } from "~/components/ui/dialog";
import { Loader2, Play } from "lucide-react";
import type { Route } from "./+types/admin.jobs";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill, type Tone } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { Toggle } from "~/components/ui/Toggle";
import { cn } from "~/lib/cn";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { JOBS, resolveJobSettings } from "~/jobs/registry";
import { Tooltip, InfoTip } from "~/components/ui/floating";

export const handle = adminHandle("jobs");

export const meta: Route.MetaFunction = () => [{ title: "Jobs · Admin · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const rows = await prisma.scheduledJob.findMany();
  const rowByName = new Map(rows.map((r) => [r.name, r]));

  // The registry is the source of truth for which jobs exist, what they do,
  // and which settings they declare; the row carries runtime state and the
  // operator-edited values. A job with no row yet (fresh DB, runner hasn't
  // ticked) still renders with defaults.
  const jobs = JOBS.map((def) => {
    const row = rowByName.get(def.name);
    return {
      name: def.name,
      description: def.description,
      intervalMinutes: row?.intervalMinutes ?? def.intervalMinutes,
      defaultIntervalMinutes: def.intervalMinutes,
      settingDefs: (def.settings ?? []).map((s) => ({
        key: s.key,
        label: s.label,
        unit: s.unit,
        min: s.min,
        max: s.max,
        default: s.default,
      })),
      settings: resolveJobSettings(def, row?.settings),
      enabled: row?.enabled ?? true,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastError: row?.lastError ?? null,
      lastDurationMs: row?.lastDurationMs ?? null,
    };
  });

  const admin = await isAdmin(auth.user.sub);
  return { jobs, isAdmin: admin };
}

type JobView = {
  name: string;
  description: string;
  intervalMinutes: number;
  defaultIntervalMinutes: number;
  settingDefs: {
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    default: number;
  }[];
  settings: Record<string, number>;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "Success" | "Error" | null;
  lastError: string | null;
  lastDurationMs: number | null;
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

type JobState = "ok" | "failing" | "running" | "paused" | "never";

const STATE: Record<JobState, { tone: Tone; label: string }> = {
  ok: { tone: "ok", label: "Healthy" },
  failing: { tone: "bad", label: "Failing" },
  running: { tone: "warn", label: "Running" },
  paused: { tone: "idle", label: "Paused" },
  never: { tone: "idle", label: "Not run yet" },
};

function jobState(job: Pick<JobView, "lastStatus">, enabled: boolean, running: boolean): JobState {
  if (running) return "running";
  if (!enabled) return "paused";
  if (job.lastStatus === "Error") return "failing";
  return job.lastStatus === "Success" ? "ok" : "never";
}

function JobRow({ job }: { job: JobView }) {
  const { actionBtn, actionBtnPrimary, compactField } = useOsChrome();
  const toggleFetcher = useFetcher();
  const runFetcher = useFetcher();
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const busy =
    toggleFetcher.state !== "idle" ||
    runFetcher.state !== "idle" ||
    saveFetcher.state !== "idle";

  const [interval, setInterval] = useState(String(job.intervalMinutes));
  const [settings, setSettings] = useState<Record<string, string>>(
    Object.fromEntries(
      job.settingDefs.map((s) => [s.key, String(job.settings[s.key] ?? s.default)]),
    ),
  );
  const dirty =
    Number(interval) !== job.intervalMinutes ||
    job.settingDefs.some((s) => Number(settings[s.key]) !== job.settings[s.key]);

  // Refresh once a Run-now or Save round-trip finishes so lastRunAt/status and
  // stored values reflect the change without a reload.
  useEffect(() => {
    if (runFetcher.state === "idle" && runFetcher.data) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetcher.state]);
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state]);

  const optimistic = toggleFetcher.json as { enabled?: boolean } | undefined;
  const enabled = optimistic?.enabled ?? job.enabled;
  const running = runFetcher.state !== "idle";
  const state = STATE[jobState(job, enabled, running)];
  const failing = job.lastStatus === "Error" && enabled;
  const duration = formatDuration(job.lastDurationMs);
  const field = cn(compactField, "w-16 border border-os-container px-2 py-1 text-xs tabular-nums");

  function save() {
    saveFetcher.submit(
      {
        intervalMinutes: Number(interval),
        settings: Object.fromEntries(
          job.settingDefs.map((s) => [s.key, Number(settings[s.key])]),
        ),
      },
      { method: "PATCH", action: `/api/jobs/${job.name}`, encType: "application/json" },
    );
  }

  async function runNow() {
    const ok = await dialog.confirm({
      title: `Run ${job.name} now?`,
      description:
        "This runs the job immediately. Some jobs (digests, reminders, scheduled announcements) may email or Slack members right away.",
      confirmLabel: "Run now",
    });
    if (!ok) return;
    runFetcher.submit(
      { action: "run" },
      { method: "POST", action: `/api/jobs/${job.name}`, encType: "application/json" },
    );
  }

  return (
    <li className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-semibold text-foreground">{job.name}</p>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
        <p className="mt-0.5 text-sm text-os-grey">{job.description}</p>
        {job.lastError && (
          <Tooltip content={job.lastError} variant="rich" placement="bottom">
            <p className="mt-2 break-all rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {job.lastError.length > 200 ? `${job.lastError.slice(0, 200)}…` : job.lastError}
            </p>
          </Tooltip>
        )}
        {saveFetcher.data?.error && (
          <p className="mt-2 text-xs text-destructive">{saveFetcher.data.error}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-os-muted">Schedule</p>
        <label className="flex items-center gap-1.5 text-os-grey">
          Every
          <Tooltip content={`Minutes between runs · 1–10080 · default ${job.defaultIntervalMinutes}`}>
            <input
              type="number"
              min={1}
              max={10080}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              aria-label={`${job.name} interval in minutes`}
              className={field}
            />
          </Tooltip>
          min
        </label>
        {job.settingDefs.map((s) => (
          <label key={s.key} className="flex flex-col gap-1 text-xs text-os-grey">
            {s.label}
            <span className="flex items-center gap-1.5">
              <Tooltip content={`${s.min}–${s.max}${s.unit ? ` ${s.unit}` : ""} · default ${s.default}`}>
                <input
                  type="number"
                  min={s.min}
                  max={s.max}
                  value={settings[s.key] ?? ""}
                  onChange={(e) => setSettings((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  className={field}
                />
              </Tooltip>
              {s.unit}
            </span>
          </label>
        ))}
      </div>

      <div className="text-sm">
        <p className="text-xs text-os-muted">Last run · next</p>
        <p className="text-foreground">
          {formatTime(job.lastRunAt)}
          {duration && <span className="text-os-muted"> ({duration})</span>}
        </p>
        <p className="text-os-grey">{enabled ? formatTime(job.nextRunAt) : "Paused"}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 md:justify-end">
        {dirty && (
          <button type="button" disabled={busy} onClick={save} className={actionBtnPrimary}>
            {saveFetcher.state !== "idle" ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={runNow}
          className={cn(failing && !dirty ? actionBtnPrimary : actionBtn(), "disabled:opacity-50")}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : failing ? "Retry now" : "Run now"}
        </button>
        <Toggle
          tone="os"
          checked={enabled}
          disabled={busy}
          aria-label={`${enabled ? "Pause" : "Resume"} ${job.name}`}
          onChange={() =>
            toggleFetcher.submit(
              { enabled: !enabled },
              { method: "PATCH", action: `/api/jobs/${job.name}`, encType: "application/json" },
            )
          }
        />
      </div>
    </li>
  );
}

export default function AdminJobs() {
  const { jobs } = useLoaderData<typeof loader>();
  const { panel } = useOsChrome();
  // Failing jobs first; otherwise the registry's order.
  const ordered = [...jobs].sort(
    (a, b) =>
      Number(b.enabled && b.lastStatus === "Error") - Number(a.enabled && a.lastStatus === "Error"),
  );
  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="platform" />
      <p className="-mt-2 flex items-center gap-1.5 text-sm text-os-grey">
        Jobs run on a one-minute tick. Pause a job to stop it; Run now never overlaps a run in progress.
        Interval and setting changes apply from the next run.
        <InfoTip content="The database row is authoritative; the values in code are only defaults. A lease prevents concurrent runs across machines." />
      </p>
      {jobs.length === 0 ? (
        <div className={panel}>
          <EmptyState>No jobs registered.</EmptyState>
        </div>
      ) : (
        <ul className={cn(panel, "divide-y divide-os-container/70")}>
          {ordered.map((job) => (
            <JobRow key={job.name} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}
