import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.games";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { Figure, MiniBar, Sparkline, adminTable } from "~/admin/components/console-ui";
import { RangeSegmented } from "~/admin/components/RangeSegmented";
import { resolveWindow, wantsAllTime } from "~/admin/lib/insights-range";
import { loadPeopleById } from "~/admin/lib/people.server";
import { summarizeTunnelRuns, type Count } from "~/admin/lib/tunnel-runs";
import { fillDays } from "~/components/analytics/chart-range";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { EmptyState } from "~/components/ui/EmptyState";
import { InfoTip } from "~/components/ui/floating";
import { requireAuth } from "~/lib/auth";
import { cn } from "~/lib/cn";
import { prisma } from "~/lib/db.server";
import { formatDuration } from "~/lib/format-duration";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";

export const handle = adminHandle("games");

export const meta: Route.MetaFunction = () => [{ title: "Games · Admin · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const earliest = wantsAllTime(url.searchParams)
    ? (await prisma.tunnelRun.aggregate({ _min: { createdAt: true } }))._min.createdAt
    : null;
  const range = resolveWindow(url.searchParams, new Date(), earliest);

  const rows = await prisma.tunnelRun.findMany({
    where: { createdAt: { gte: range.since, lte: range.until } },
    select: { userId: true, score: true, durationMs: true, endedBy: true, obstacle: true, createdAt: true },
  });
  const summary = summarizeTunnelRuns(rows);

  const perDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const series = fillDays(
    range.firstDay,
    range.lastDay,
    [...perDay].map(([day, count]) => ({ day, count })),
    { count: 0 },
  ).map((d) => d.count);

  const people = await loadPeopleById(
    prisma,
    summary.playerRows.map((p) => p.userId),
  );
  const players = summary.playerRows.map((p) => {
    const person = people.get(p.userId);
    return { ...p, name: person?.name ?? "A DALI member", photoUrl: person?.photoUrl ?? null };
  });

  return { rangeKey: range.key, rangeLabel: range.label, summary: { ...summary, playerRows: players }, series };
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Bars({ title, info, rows, total }: { title: string; info?: string; rows: Count[]; total: number }) {
  const { panel } = useOsChrome();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className={cn(panel, "flex flex-col gap-4 p-6")} aria-label={title}>
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
        {title}
        {info && <InfoTip content={info} />}
      </h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
            <span className="truncate text-os-grey">{r.label}</span>
            <MiniBar fraction={r.count / max} className="h-1.5" />
            <span className="text-right tabular-nums text-foreground">
              {r.count.toLocaleString()}
              {total > 0 && (
                <span className="ml-1.5 text-xs text-os-muted">{Math.round((r.count / total) * 100)}%</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminGames() {
  const { rangeKey, rangeLabel, summary, series } = useLoaderData<typeof loader>();
  const { panel } = useOsChrome();
  const { learning } = summary;

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="insights" />

      <section className={cn(panel, "p-6")} aria-label="Tunnel run totals">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
            <Figure size="lg" label={`Tunnel runs · ${rangeLabel}`} value={summary.runs.toLocaleString()} detail={`${summary.quits.toLocaleString()} left early`} />
            <Figure label="Players" value={summary.players.toLocaleString()} detail="Played at least once" />
            <Figure label="Median score" value={summary.medianScore?.toLocaleString() ?? "n/a"} detail={summary.bestScore === null ? undefined : `Best ${summary.bestScore.toLocaleString()}`} />
            <Figure label="Median run" value={formatDuration(summary.medianDurationMs)} detail="From start to fall or leaving" />
          </div>
          <RangeSegmented value={rangeKey} customLabel={rangeLabel} />
        </div>
        <div className="mt-6">
          <p className="mb-2 text-xs text-os-muted">Runs per day</p>
          <Sparkline values={series} height={48} />
        </div>
      </section>

      {summary.runs === 0 ? (
        <EmptyState>No tunnel runs in this window.</EmptyState>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Bars
              title="How runs end"
              info="Which part of the course each run ended on. Runs from before the run log was added show as not recorded."
              rows={summary.endings}
              total={summary.runs}
            />
            <Bars title="Scores" rows={summary.scoreBuckets} total={summary.runs} />
            <Bars title="Runs per player" rows={summary.runsPerPlayer} total={summary.players} />
            <section className={cn(panel, "flex flex-col gap-4 p-6")} aria-label="Getting better">
              <h2 className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                Getting better
                <InfoTip content="Each player's first run in this window, against every run from their fifth on." />
              </h2>
              <div className="flex flex-wrap gap-x-12 gap-y-4">
                <Figure label="First runs" value={learning.firstRunMedian?.toLocaleString() ?? "n/a"} detail="Median score" />
                <Figure
                  label="Fifth run on"
                  value={learning.laterRunMedian?.toLocaleString() ?? "n/a"}
                  detail={learning.laterRuns ? `Median of ${learning.laterRuns.toLocaleString()} runs` : "Nobody has played five yet"}
                />
              </div>
            </section>
          </div>

          <div className={cn(adminTable.wrap, "os-scroll")}>
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={adminTable.th}>Player</th>
                  <th className={cn(adminTable.th, "text-right")}>Runs</th>
                  <th className={cn(adminTable.th, "text-right")}>Best</th>
                  <th className={cn(adminTable.th, "text-right")}>Median</th>
                  <th className={cn(adminTable.th, "text-right")}>Last played</th>
                </tr>
              </thead>
              <tbody>
                {summary.playerRows.map((p) => (
                  <tr key={p.userId} className={adminTable.row}>
                    <td className={adminTable.td}>
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="truncate font-semibold text-foreground">{p.name}</span>
                      </div>
                    </td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>{p.runs.toLocaleString()}</td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>{p.best.toLocaleString()}</td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-os-grey")}>{p.medianScore.toLocaleString()}</td>
                    <td className={cn(adminTable.td, "whitespace-nowrap text-right text-os-grey")}>{formatDay(p.lastPlayed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs text-os-muted">
        Every run on the week 10 home screen is logged when it ends, whether the runner falls or leaves. Scores and run
        lengths are reported by the browser and not verified.
      </p>
    </div>
  );
}
