import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.ai-usage";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { loadPeopleById } from "~/admin/lib/people.server";
import { cn } from "~/lib/cn";
import { EmptyState, Figure, MiniBar, Sparkline, adminTable } from "~/admin/components/console-ui";
import { RangeSegmented } from "~/admin/components/RangeSegmented";
import { resolveWindow, wantsAllTime } from "~/admin/lib/insights-range";
import { fillDays } from "~/components/analytics/chart-range";
import { AI_COST_PER_MILLION_TOKENS, estimateAiCost, formatUsd } from "~/admin/lib/ai-cost";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { InfoTip, Tooltip } from "~/components/ui/floating";

export const handle = adminHandle("ai-usage");

export const meta: Route.MetaFunction = () => [
  { title: "AI Usage · Admin · DALI OS" },
];

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const earliest = wantsAllTime(url.searchParams)
    ? (await prisma.aiUsage.aggregate({ _min: { day: true } }))._min.day
    : null;
  const range = resolveWindow(
    url.searchParams,
    new Date(),
    earliest ? new Date(`${earliest}T00:00:00Z`) : null,
  );
  // AiUsage.day is a "YYYY-MM-DD" string, so day keys compare correctly as strings.
  const inWindow = { day: { gte: range.firstDay, lte: range.lastDay } };

  const perUser = await prisma.aiUsage.groupBy({
    by: ["userId"],
    where: inWindow,
    _sum: { count: true, inputTokens: true, outputTokens: true },
    _max: { day: true },
    orderBy: { _sum: { count: "desc" } },
  });

  const userById = await loadPeopleById(
    prisma,
    perUser.map((r) => r.userId),
  );

  const totals = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const rows = perUser.map((r) => {
    const u = userById.get(r.userId);
    const requests = r._sum.count ?? 0;
    const inputTokens = r._sum.inputTokens ?? 0;
    const outputTokens = r._sum.outputTokens ?? 0;
    totals.requests += requests;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    return {
      userId: r.userId,
      name: u?.name ?? r.userId,
      email: u?.email ?? null,
      photoUrl: u?.photoUrl ?? null,
      requests,
      inputTokens,
      outputTokens,
      lastUsed: r._max.day,
    };
  });

  const dayRows = await prisma.aiUsage.groupBy({
    by: ["day"],
    where: inWindow,
    _sum: { count: true },
  });
  const series = fillDays(
    range.firstDay,
    range.lastDay,
    dayRows.map((r) => ({ day: r.day, count: r._sum.count ?? 0 })),
    { count: 0 },
  ).map((d) => d.count);

  const admin = await isAdmin(auth.user.sub);
  return {
    rangeKey: range.key,
    rangeLabel: range.label,
    rows,
    totals,
    series,
    isAdmin: admin,
  };
}

function formatDay(day: string | null): string {
  if (!day) return "—";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const COST_NOTE = `Estimate at $${AI_COST_PER_MILLION_TOKENS.input} per 1M input tokens and $${AI_COST_PER_MILLION_TOKENS.output} per 1M output tokens. Not a bill.`;

export default function AdminConsoleAiUsage() {
  const { rangeKey, rangeLabel, rows, totals, series } = useLoaderData<typeof loader>();
  const { panel } = useOsChrome();
  const maxTokens = Math.max(1, ...rows.map((r) => r.inputTokens + r.outputTokens));
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const totalCost = estimateAiCost(totals.inputTokens, totals.outputTokens);

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="insights" />

      <section className={cn(panel, "p-6")} aria-label="AI usage totals">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
            <Figure
              size="lg"
              label={`Tokens · ${rangeLabel}`}
              value={compact.format(totalTokens)}
              detail={`${compact.format(totals.inputTokens)} input · ${compact.format(totals.outputTokens)} output`}
            />
            <Figure label="Requests" value={totals.requests.toLocaleString()} detail={rangeLabel} />
            <Figure label="Members" value={rows.length.toLocaleString()} detail="Used AI in window" />
            <Figure
              label={
                <span className="inline-flex items-center gap-1">
                  Est. cost
                  <InfoTip content={COST_NOTE} />
                </span>
              }
              value={formatUsd(totalCost)}
              detail="Estimate"
            />
          </div>
          <div className="flex items-center gap-2">
            <InfoTip
              label="About quotas"
              content="Each member is limited to 200 AI doc-writing requests per day and 10 per minute (burst). Token counts are best-effort. A request can appear without tokens if the call was cancelled or failed."
            />
            <RangeSegmented value={rangeKey} customLabel={rangeLabel} />
          </div>
        </div>
        <div className="mt-6">
          <p className="mb-2 text-xs text-os-muted">Requests per day</p>
          <Sparkline values={series} height={48} />
        </div>
      </section>

      <div className={cn(adminTable.wrap, "os-scroll")}>
        {rows.length === 0 ? (
          <EmptyState>No AI usage in this window.</EmptyState>
        ) : (
          <table className="w-full min-w-[860px]">
            <thead>
              <tr>
                <th className={adminTable.th}>Member</th>
                <th className={cn(adminTable.th, "text-right")}>Requests</th>
                <th className={cn(adminTable.th, "w-[30%]")}>Tokens</th>
                <th className={cn(adminTable.th, "text-right")}>Est. cost</th>
                <th className={cn(adminTable.th, "text-right")}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tokens = r.inputTokens + r.outputTokens;
                const share =
                  totals.requests > 0 ? Math.round((r.requests / totals.requests) * 100) : 0;
                return (
                  <tr key={r.userId} className={adminTable.row}>
                    <td className={adminTable.td}>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} photoUrl={r.photoUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{r.name}</p>
                          {r.email && r.email !== r.name && (
                            <p className="truncate text-xs text-os-muted">{r.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={cn(adminTable.td, "whitespace-nowrap text-right tabular-nums text-foreground")}>
                      {r.requests.toLocaleString()}
                      <span className="ml-1.5 text-xs text-os-accent">{share}%</span>
                    </td>
                    <td className={adminTable.td}>
                      <Tooltip
                        content={`${r.inputTokens.toLocaleString()} input · ${r.outputTokens.toLocaleString()} output`}
                      >
                        <div className="flex items-center gap-3">
                          <MiniBar fraction={tokens / maxTokens} className="h-1.5 flex-1" />
                          <span className="w-14 text-right tabular-nums text-foreground">
                            {compact.format(tokens)}
                          </span>
                        </div>
                      </Tooltip>
                    </td>
                    <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>
                      {formatUsd(estimateAiCost(r.inputTokens, r.outputTokens))}
                    </td>
                    <td className={cn(adminTable.td, "whitespace-nowrap text-right text-os-grey")}>
                      {formatDay(r.lastUsed)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-os-muted">
        Requests are counted at the daily quota gate (200 per day, 10 per minute per member). Token
        counts are recorded after each model call, so a row can show requests with fewer tokens if a
        call failed or was cancelled early. {COST_NOTE}
      </p>
    </div>
  );
}
