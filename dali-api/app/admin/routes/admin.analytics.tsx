import { redirect, useLoaderData, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/admin.analytics";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Figure, MiniBar, adminTable } from "~/admin/components/console-ui";
import { RangeSegmented } from "~/admin/components/RangeSegmented";
import { ALL_TIME, resolveWindow, wantsAllTime } from "~/admin/lib/insights-range";
import { fillDays, shortDay } from "~/components/analytics/chart-range";
import { ChartLegend, TimeSeriesChart, type ChartSeries } from "~/components/analytics/TimeSeriesChart";
import { useOsChrome } from "~/components/os-chrome";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { formatDuration } from "~/lib/format-duration";
import { percentChange, priorViewsByPath } from "~/lib/analytics-compare.server";

export const handle = adminHandle("analytics");

export const meta: Route.MetaFunction = () => [
  { title: "Analytics · Admin · DALI OS" },
];

// Slim usage + crash dashboard for a mandated internal tool. Growth and
// retention mean little when usage is captive; what's useful is whether the
// deploy is alive, which features earn their keep (top routes), what could be
// deleted (rarely visited routes), whether anything is broken (errors), and
// where it's used (web / desktop / mobile, MCP).

type DayRow = { day: string; count: number; users: number };
type RouteRow = {
  path: string;
  views: number;
  users: number;
  medianMs: number | null;
};
type ClientRow = { client: string | null; views: number; users: number };
type McpRow = { name: string; calls: number; users: number };
const CLIENT_LABELS: Record<string, string> = {
  web: "Web",
  desktop: "Desktop app",
  mobile: "Mobile",
};
type ErrorRow = {
  message: string;
  count: number;
  users: number;
  firstSeen: Date;
  lastSeen: Date;
};

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function earliestPageViewOrError(): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ earliest: Date | null }[]>`
    SELECT LEAST(
      (SELECT MIN("createdAt") FROM "PageView"),
      (SELECT MIN("createdAt") FROM "ClientError")
    ) AS earliest
  `;
  return row?.earliest ?? null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const range = resolveWindow(
    url.searchParams,
    new Date(),
    wantsAllTime(url.searchParams) ? await earliestPageViewOrError() : null,
  );
  const allTime = range.key === ALL_TIME.key;
  const { since, until } = range;
  const sevenDaysAgo = sinceDate(7);

  // Always 7d regardless of the range selector, so it stays a stable
  // "is the deploy alive?" health check.
  const [wauRow] = await prisma.$queryRaw<{ wau: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS wau
    FROM "PageView"
    WHERE "createdAt" >= ${sevenDaysAgo} AND "userId" IS NOT NULL
  `;

  const dayRows = await prisma.$queryRaw<DayRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count,
           COUNT(DISTINCT "userId")::int AS users
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY 1 ORDER BY 1 ASC
  `;
  const trend = fillDays(range.firstDay, range.lastDay, dayRows, { count: 0, users: 0 });

  // Paths are normalized, so /projects/:id collapses across all projects.
  const topRoutes = await prisma.$queryRaw<RouteRow[]>`
    SELECT "path",
           COUNT(*)::int AS views,
           COUNT(DISTINCT "userId")::int AS users,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs")::float AS "medianMs"
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY "path"
    ORDER BY views DESC
    LIMIT 10
  `;
  const prior = allTime
    ? null
    : await priorViewsByPath(
        prisma,
        topRoutes.map((r) => r.path),
        since,
        range.days,
      );

  // "Rarely visited" rather than "never visited": a route with zero PageView
  // rows isn't measurable from this table. The long tail is the actionable
  // "consider deleting this" signal.
  const bottomRoutes = await prisma.$queryRaw<RouteRow[]>`
    SELECT "path",
           COUNT(*)::int AS views,
           COUNT(DISTINCT "userId")::int AS users,
           NULL::float AS "medianMs"
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY "path"
    HAVING COUNT(*) < 5
    ORDER BY views ASC, "path" ASC
    LIMIT 10
  `;

  const clientRows = await prisma.$queryRaw<ClientRow[]>`
    SELECT "client",
           COUNT(*)::int AS views,
           COUNT(DISTINCT "userId")::int AS users
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY "client"
    ORDER BY views DESC
  `;

  const [mcpTotals] = await prisma.$queryRaw<{ calls: number; users: number }[]>`
    SELECT COUNT(*)::int AS calls,
           COUNT(DISTINCT "userId")::int AS users
    FROM "AuditLog"
    WHERE "action" IN ('mcp.tool_called', 'mcp.tool_read') AND "createdAt" >= ${since} AND "createdAt" < ${until}
  `;
  const mcpTools = await prisma.$queryRaw<McpRow[]>`
    SELECT COALESCE("metadata"->>'toolName', 'unknown') AS name,
           COUNT(*)::int AS calls,
           COUNT(DISTINCT "userId")::int AS users
    FROM "AuditLog"
    WHERE "action" IN ('mcp.tool_called', 'mcp.tool_read') AND "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY 1
    ORDER BY calls DESC, name ASC
    LIMIT 10
  `;
  const mcpClients = await prisma.$queryRaw<McpRow[]>`
    SELECT COALESCE("metadata"->>'clientName', 'unknown') AS name,
           COUNT(*)::int AS calls,
           COUNT(DISTINCT "userId")::int AS users
    FROM "AuditLog"
    WHERE "action" IN ('mcp.tool_called', 'mcp.tool_read') AND "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY 1
    ORDER BY calls DESC, name ASC
    LIMIT 10
  `;

  const errorDayRows = await prisma.$queryRaw<{ day: string; count: number }[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count
    FROM "ClientError"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY 1 ORDER BY 1 ASC
  `;
  const errorTrend = fillDays(range.firstDay, range.lastDay, errorDayRows, { count: 0 });

  const errorRows = await prisma.$queryRaw<ErrorRow[]>`
    SELECT "message",
           COUNT(*)::int AS count,
           COUNT(DISTINCT "userId")::int AS users,
           MIN("createdAt") AS "firstSeen",
           MAX("createdAt") AS "lastSeen"
    FROM "ClientError"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
    GROUP BY "message"
    ORDER BY "lastSeen" DESC
    LIMIT 50
  `;

  const admin = await isAdmin(auth.user.sub);
  return {
    rangeKey: range.key,
    rangeLabel: range.label,
    rangePhrase: range.phrase,
    rangeDays: range.days,
    wau: wauRow?.wau ?? 0,
    trend,
    topRoutes: topRoutes.map((r) => ({
      ...r,
      change: prior ? percentChange(r.views, prior.get(r.path) ?? 0) : null,
    })),
    bottomRoutes,
    clientRows,
    mcpTotals: mcpTotals ?? { calls: 0, users: 0 },
    mcpTools,
    mcpClients,
    errorTrend,
    totalErrors: errorTrend.reduce((s, d) => s + d.count, 0),
    errors: errorRows.map((e) => ({
      ...e,
      firstSeen: e.firstSeen.toISOString(),
      lastSeen: e.lastSeen.toISOString(),
    })),
    isAdmin: admin,
  };
}

function ErrorBars({ series }: { series: { day: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  return (
    <div className="flex h-12 items-end gap-px" aria-hidden>
      {series.map((d) => (
        <div
          key={d.day}
          className="min-w-px flex-1 rounded-sm bg-os-amber/60 hover:bg-os-amber"
          style={{ height: `${Math.max(4, Math.round((d.count / max) * 100))}%` }}
          title={`${shortDay(d.day)}: ${d.count}`}
        />
      ))}
    </div>
  );
}

const TRAFFIC_SERIES: ChartSeries[] = [
  { key: "views", name: "Pageviews", color: "var(--color-os-accent)" },
  { key: "visitors", name: "Visitors (distinct users per day)", color: "var(--color-os-grey)", dashed: true },
];

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-os-muted">New</span>;
  return (
    <span className={value >= 0 ? "text-os-green" : "text-destructive"}>
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}

function CountTable({
  rows,
  nameHeader,
  countHeader,
}: {
  rows: { key: string; name: ReactNode; users: number; count: number }[];
  nameHeader: string;
  countHeader: string;
}) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={cn(adminTable.th, "w-[65%]")}>{nameHeader}</th>
          <th className={cn(adminTable.th, "text-right")}>Users</th>
          <th className={cn(adminTable.th, "text-right")}>{countHeader}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={adminTable.row}>
            <td className={cn(adminTable.td, "max-w-0 truncate")}>{r.name}</td>
            <td className={cn(adminTable.td, "text-right tabular-nums text-os-grey")}>{r.users}</td>
            <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminConsoleAnalytics() {
  const {
    rangeKey,
    rangeLabel,
    rangePhrase,
    rangeDays,
    wau,
    trend,
    topRoutes,
    bottomRoutes,
    clientRows,
    mcpTotals,
    mcpTools,
    mcpClients,
    errorTrend,
    totalErrors,
    errors,
  } = useLoaderData<typeof loader>();
  const { panel, sectionTitle } = useOsChrome();
  const navigate = useNavigate();

  const views = trend.reduce((s, d) => s + d.count, 0);
  const avgVisitors = Math.round(trend.reduce((s, d) => s + d.users, 0) / Math.max(1, trend.length));
  const peak = trend.reduce((best, d) => (d.count > best.count ? d : best), trend[0] ?? { day: "", count: 0, users: 0 });
  const maxTopViews = Math.max(1, ...topRoutes.map((r) => r.views));
  const pathCell = (path: string) => (
    <code className="font-mono text-xs text-foreground">{path || "/"}</code>
  );

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="insights" />

      <section className={cn(panel, "p-6")} aria-labelledby="traffic-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <Figure
              size="lg"
              label={<span id="traffic-title">Pageviews · {rangeLabel}</span>}
              value={views.toLocaleString()}
            />
            <Figure label="Active users" value={wau.toLocaleString()} detail="Distinct logins, last 7 days" />
            <Figure label="Avg. daily visitors" value={avgVisitors.toLocaleString()} />
            <Figure
              label="Peak day"
              value={peak.count.toLocaleString()}
              detail={peak.count > 0 ? shortDay(peak.day) : "No views yet"}
            />
            <Figure
              label="Client errors"
              value={<span className={totalErrors > 0 ? "text-os-amber" : "text-os-green"}>{totalErrors.toLocaleString()}</span>}
              detail={`${errors.length} distinct`}
            />
          </div>
          <RangeSegmented value={rangeKey} customLabel={rangeLabel} />
        </div>
        <div className="mt-6">
          <TimeSeriesChart
            data={trend.map((d) => ({ day: d.day, views: d.count, visitors: d.users }))}
            series={TRAFFIC_SERIES}
            onSelectRange={({ from, to }) =>
              navigate(`?from=${from}&to=${to}`, { preventScrollReset: true })
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ChartLegend series={TRAFFIC_SERIES} />
          <span className="text-xs text-os-muted">Drag across the chart to zoom in</span>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="pages-title">
        <h2 id="pages-title" className={sectionTitle}>
          Top pages · {rangeLabel}
        </h2>
        <div className={cn(adminTable.wrap, "os-scroll")}>
          {topRoutes.length === 0 ? (
            <EmptyState>No pageviews in window.</EmptyState>
          ) : (
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={adminTable.th}>Page</th>
                  <th className={cn(adminTable.th, "text-right")}>Users</th>
                  <th className={cn(adminTable.th, "text-right")}>Median time</th>
                  <th className={cn(adminTable.th, "w-[28%]")}>Views</th>
                  {rangeKey !== ALL_TIME.key && (
                    <th className={cn(adminTable.th, "text-right")}>vs. prior {rangeDays} days</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {topRoutes.map((r) => (
                  <tr key={r.path} className={adminTable.row}>
                    <td className={adminTable.td}>{pathCell(r.path)}</td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-os-grey")}>{r.users}</td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-os-grey")}>
                      {formatDuration(r.medianMs)}
                    </td>
                    <td className={adminTable.td}>
                      <div className="flex items-center gap-3">
                        <MiniBar fraction={r.views / maxTopViews} className="h-1.5 flex-1" />
                        <span className="w-14 text-right tabular-nums text-foreground">
                          {r.views.toLocaleString()}
                        </span>
                      </div>
                    </td>
                    {rangeKey !== ALL_TIME.key && (
                      <td className={cn(adminTable.td, "text-right tabular-nums")}>
                        <Change value={r.change} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3" aria-labelledby="rare-title">
          <h2 id="rare-title" className={sectionTitle}>
            Rarely used pages
          </h2>
          <div className={adminTable.wrap}>
            {bottomRoutes.length === 0 ? (
              <EmptyState>Every visited route saw at least 5 hits. Nothing looks unused.</EmptyState>
            ) : (
              <CountTable
                nameHeader="Page"
                countHeader="Views"
                rows={bottomRoutes.map((r) => ({
                  key: r.path,
                  name: pathCell(r.path),
                  users: r.users,
                  count: r.views,
                }))}
              />
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="apps-title">
          <h2 id="apps-title" className={sectionTitle}>
            By app
          </h2>
          <div className={adminTable.wrap}>
            {clientRows.length === 0 ? (
              <EmptyState>No pageviews in window.</EmptyState>
            ) : (
              <CountTable
                nameHeader="App"
                countHeader="Views"
                rows={clientRows.map((r) => ({
                  key: r.client ?? "unknown",
                  name: (
                    <span className="text-foreground">
                      {r.client ? (CLIENT_LABELS[r.client] ?? r.client) : "Not recorded"}
                    </span>
                  ),
                  users: r.users,
                  count: r.views,
                }))}
              />
            )}
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="mcp-title">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="mcp-title" className={sectionTitle}>
            MCP
          </h2>
          <span className="text-sm tabular-nums text-os-muted">
            {mcpTotals.calls.toLocaleString()} calls · {mcpTotals.users} users
          </span>
        </div>
        <div className={adminTable.wrap}>
          {mcpTotals.calls === 0 ? (
            <EmptyState>No MCP tool calls in {rangePhrase}.</EmptyState>
          ) : (
            <div className="grid divide-y divide-os-container/70 md:grid-cols-2 md:divide-x md:divide-y-0">
              {[
                { title: "Tool", rows: mcpTools },
                { title: "Client", rows: mcpClients },
              ].map((list) => (
                <CountTable
                  key={list.title}
                  nameHeader={list.title}
                  countHeader="Calls"
                  rows={list.rows.map((r) => ({
                    key: r.name,
                    name: <code className="font-mono text-xs text-foreground">{r.name}</code>,
                    users: r.users,
                    count: r.calls,
                  }))}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="errors-title">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="errors-title" className={cn(sectionTitle, "inline-flex items-center gap-2")}>
            <AlertTriangle className="h-4 w-4 text-os-amber" />
            Client errors
          </h2>
          <span className="text-sm tabular-nums text-os-muted">
            {totalErrors} in {rangeDays} days · {errors.length} distinct
          </span>
        </div>
        <div className={cn(adminTable.wrap, "os-scroll")}>
          <div className="px-6 pb-4 pt-5">
            <ErrorBars series={errorTrend} />
          </div>
          {errors.length === 0 ? (
            <EmptyState>No client errors in {rangePhrase}.</EmptyState>
          ) : (
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className={adminTable.th}>Message</th>
                  <th className={cn(adminTable.th, "text-right")}>Count</th>
                  <th className={cn(adminTable.th, "text-right")}>Users</th>
                  <th className={cn(adminTable.th, "text-right")}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.message} className={adminTable.row}>
                    <td className={cn(adminTable.td, "max-w-md")}>
                      <Tooltip content={e.message} variant="rich" placement="bottom">
                        <code className="block truncate font-mono text-xs text-foreground">{e.message}</code>
                      </Tooltip>
                    </td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>{e.count}</td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-os-grey")}>{e.users}</td>
                    <td className={cn(adminTable.td, "whitespace-nowrap text-right text-os-grey")}>
                      {new Date(e.lastSeen).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
