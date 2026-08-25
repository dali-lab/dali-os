import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.ai-usage";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { Sparkles } from "lucide-react";
import { Sparkline, MiniBar } from "~/admin/components/console-ui";

export const handle = adminHandle("ai-usage");

export const meta: Route.MetaFunction = () => [
  { title: "AI Usage · Admin · DALI OS" },
];

const RANGE_OPTIONS = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "30d", days: 30, label: "30 days" },
  { key: "90d", days: 90, label: "90 days" },
] as const;

function resolveRange(raw: string | null) {
  return RANGE_OPTIONS.find((r) => r.key === raw) ?? RANGE_OPTIONS[1];
}

// AiUsage.day is a "YYYY-MM-DD" string — ISO dates compare correctly as
// strings. Inclusive of today: 7 days = today plus the six before it.
function sinceDay(days: number): string {
  return new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const range = resolveRange(url.searchParams.get("range"));
  const since = sinceDay(range.days);

  const perUser = await prisma.aiUsage.groupBy({
    by: ["userId"],
    where: { day: { gte: since } },
    _sum: { count: true, inputTokens: true, outputTokens: true },
    _max: { day: true },
    orderBy: { _sum: { count: "desc" } },
  });

  const users =
    perUser.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: perUser.map((r) => r.userId) } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        });
  const userById = new Map(users.map((u) => [u.id, u]));

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
      name: (u && (fullName(u) || u.daliEmail)) ?? r.userId,
      email: u?.daliEmail ?? null,
      requests,
      inputTokens,
      outputTokens,
      lastUsed: r._max.day,
    };
  });

  const dayRows = await prisma.aiUsage.groupBy({
    by: ["day"],
    where: { day: { gte: since } },
    _sum: { count: true },
  });
  const byDay = new Map(dayRows.map((r) => [r.day, r._sum.count ?? 0]));
  const series: number[] = [];
  for (let i = range.days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? 0);
  }

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

function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold text-foreground tabular-nums">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground/70">{caption}</div>
    </section>
  );
}

export default function AdminConsoleAiUsage() {
  const { rangeKey, rangeLabel, rows, totals, series } =
    useLoaderData<typeof loader>();

  const maxRequests = rows[0]?.requests || 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">AI usage</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          {rangeLabel}
        </span>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r.key}
              to={r.key === "30d" ? "?" : `?range=${r.key}`}
              prefetch="render"
              className={`px-2 py-1 rounded-md ${
                r.key === rangeKey
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Requests"
          value={totals.requests.toLocaleString()}
          caption={`last ${rangeLabel}`}
        />
        <StatCard
          label="Members"
          value={rows.length.toLocaleString()}
          caption="used AI in window"
        />
        <StatCard
          label="Input tokens"
          value={compact.format(totals.inputTokens)}
          caption={`last ${rangeLabel}`}
        />
        <StatCard
          label="Output tokens"
          value={compact.format(totals.outputTokens)}
          caption={`last ${rangeLabel}`}
        />
      </div>

      <section className="bg-card border border-border rounded-lg px-4 py-3">
        <p className="text-xs text-muted-foreground mb-2">
          Requests / day · last {rangeLabel}
        </p>
        <Sparkline values={series} />
      </section>

      <section className="bg-card border border-border rounded-lg divide-y divide-border">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/70">
            No AI usage in this window.
          </div>
        ) : (
          rows.map((r) => {
            const share =
              totals.requests > 0
                ? Math.round((r.requests / totals.requests) * 100)
                : 0;
            return (
              <div key={r.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{r.name}</div>
                  {r.email && r.email !== r.name && (
                    <div className="text-xs text-muted-foreground truncate">
                      {r.email}
                    </div>
                  )}
                  <div className="mt-1.5">
                    <MiniBar fraction={r.requests / maxRequests} />
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="text-sm font-semibold text-foreground tabular-nums">
                    {r.requests.toLocaleString()}{" "}
                    <span className="text-xs font-normal text-accent-coral tabular-nums">
                      {share}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {compact.format(r.inputTokens + r.outputTokens)} tok
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      <p className="text-[11px] text-muted-foreground/70">
        Requests are counted at the daily-quota gate (200/day, 10/min burst per
        member); token counts are best-effort telemetry recorded after each
        model call, so a row can show requests with fewer tokens if a call
        failed or was cancelled early.
      </p>
    </div>
  );
}
