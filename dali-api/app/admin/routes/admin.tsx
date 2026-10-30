import { Link, redirect, useLoaderData } from "react-router";
import { AlertCircle, AlertTriangle, ArrowRight } from "lucide-react";
import type { Route } from "./+types/admin";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { cn } from "~/lib/cn";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { EMAIL_PURPOSE_KEYS, EMAIL_PURPOSES } from "~/lib/email-identities";
import { ADMIN_OVERVIEW } from "~/admin/adminNav";
import { loadAdminAttention } from "~/admin/lib/attention.server";
import { StatusDot, UsageGauge, type Tone } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { AuditActorAvatar, AuditActorName } from "~/admin/components/AuditActor";
import { loadPeopleById } from "~/admin/lib/people.server";

export const meta: Route.MetaFunction = () => [{ title: "Admin · DALI OS" }];

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Admin's Overview: live health up top, what needs attention, and recent
// activity. Every tool lives in the sidebar. Any Core member may enter. All
// signals are cheap counts with 0/empty fallbacks, so it degrades gracefully on
// an empty table.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) return redirect("/");

  const dayUtc = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  // Presence: lastActiveAt is bumped ≤ once/60s in requireAuth. "On site" = the
  // 5-minute active window the status dots use; "last hour" is the recent tail.
  // This is an anonymous aggregate, so it ignores hideActivity (which gates the
  // per-user dot's visibility to peers, not the write path).
  const activeSince = new Date(now - 5 * 60 * 1000);
  const hourSince = new Date(now - 60 * 60 * 1000);

  const [
    admin,
    activeNow,
    activeHour,
    jobsEnabled,
    jobsFailing,
    outboundPending,
    outboundDead,
    aiAgg,
    siteErrors24h,
    senderRows,
    auditRows,
    attention,
  ] = await Promise.all([
    isAdmin(auth.user.sub),
    prisma.user.count({ where: { lastActiveAt: { gte: activeSince } } }),
    prisma.user.count({ where: { lastActiveAt: { gte: hourSince } } }),
    prisma.scheduledJob.count({ where: { enabled: true } }),
    prisma.scheduledJob.count({ where: { enabled: true, lastStatus: "Error" } }),
    prisma.outboundMessage.count({ where: { status: "Pending" } }),
    prisma.outboundMessage.count({ where: { status: "Dead" } }),
    prisma.aiUsage.aggregate({
      where: { day: dayUtc },
      _sum: { count: true, inputTokens: true, outputTokens: true },
    }),
    prisma.clientError.count({ where: { createdAt: { gte: since24h } } }),
    listSenderIntegrations(),
    prisma.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 7,
    }),
    loadAdminAttention(),
  ]);

  // Newest enabled row per purpose (matches the Email Senders page resolution).
  const byPurpose = new Map<string, (typeof senderRows)[number]>();
  for (const row of senderRows) {
    if (row.enabled && !byPurpose.has(row.purpose)) byPurpose.set(row.purpose, row);
  }
  const connectedIds = [...byPurpose.values()].map((r) => r.id);

  const auditUserIds = new Set<string>();
  for (const e of auditRows) {
    if (e.userId) auditUserIds.add(e.userId);
    if (e.targetId) auditUserIds.add(e.targetId);
  }

  // Second hop: today's per-sender usage + activity-feed display names.
  const [usageRows, auditById] = await Promise.all([
    connectedIds.length
      ? prisma.senderDailyUsage.findMany({
          where: { senderId: { in: connectedIds }, day: dayUtc },
          select: { senderId: true, count: true },
        })
      : Promise.resolve([]),
    loadPeopleById(prisma, auditUserIds),
  ]);
  const usageById = new Map(usageRows.map((u) => [u.senderId, u.count]));

  const senders = EMAIL_PURPOSE_KEYS.map((purpose) => {
    const row = byPurpose.get(purpose);
    return {
      purpose,
      label: EMAIL_PURPOSES[purpose].label,
      connected: !!row?.sendAsEmail,
      today: row ? (usageById.get(row.id) ?? 0) : 0,
      cap: row?.dailyCap ?? null,
    };
  });

  const recent = auditRows.map((e) => ({
    id: e.id,
    action: e.action,
    actor: e.userId ? (auditById.get(e.userId) ?? null) : null,
    actorId: e.userId,
    target: e.targetId ? (auditById.get(e.targetId)?.name ?? null) : null,
    createdAt: e.createdAt.toISOString(),
  }));

  return {
    isAdmin: admin,
    attention: attention.items,
    health: {
      activeNow,
      activeHour,
      jobsEnabled,
      jobsFailing,
      outboundPending,
      outboundDead,
      aiRequests: aiAgg._sum.count ?? 0,
      aiTokens: (aiAgg._sum.inputTokens ?? 0) + (aiAgg._sum.outputTokens ?? 0),
      siteErrors24h,
    },
    senders,
    recent,
  };
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function HealthTile({
  to,
  label,
  tone,
  primary,
  secondary,
}: {
  to: string;
  label: string;
  tone: Tone;
  primary: string;
  secondary: string;
}) {
  return (
    <Link to={to} className="flex flex-col gap-1.5 bg-os-card p-5 transition-colors hover:bg-os-card-hover">
      <span className="flex items-center gap-2 text-xs font-semibold text-os-muted">
        <StatusDot tone={tone} />
        {label}
      </span>
      <span className="font-heading text-[28px] font-semibold leading-none tabular-nums text-foreground">
        {primary}
      </span>
      <span className="text-xs tabular-nums text-os-grey">{secondary}</span>
    </Link>
  );
}

export default function AdminOverview() {
  const { health, senders, recent, attention } = useLoaderData<typeof loader>();
  const { pageTitle, bodyText, panel, sectionTitle, actionBtn } = useOsChrome();

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className={pageTitle}>Admin</h1>
        <p className={cn(bodyText, "mt-1.5 max-w-2xl")}>
          {ADMIN_OVERVIEW.description} Every tool lives in the sidebar.
        </p>
      </header>

      <section
        aria-label="System health"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-os-card bg-os-container/60 sm:grid-cols-3 lg:grid-cols-5"
      >
        <HealthTile
          to="/members"
          label="Live now"
          tone={health.activeNow > 0 ? "ok" : "idle"}
          primary={String(health.activeNow)}
          secondary={`${health.activeHour} in the last hour`}
        />
        <HealthTile
          to="/admin/platform/jobs"
          label="Jobs"
          tone={health.jobsFailing > 0 ? "bad" : health.jobsEnabled > 0 ? "ok" : "idle"}
          primary={`${health.jobsEnabled} on`}
          secondary={health.jobsFailing > 0 ? `${health.jobsFailing} failing` : "None failing"}
        />
        <HealthTile
          to="/admin/messaging/outbox"
          label="Outbox"
          tone={health.outboundDead > 0 ? "bad" : health.outboundPending > 0 ? "warn" : "ok"}
          primary={health.outboundDead > 0 ? `${health.outboundDead} failed` : `${health.outboundPending} pending`}
          secondary={health.outboundDead > 0 ? `${health.outboundPending} pending` : "None failed"}
        />
        <HealthTile
          to="/admin/insights/ai-usage"
          label="AI today"
          tone={health.aiRequests > 0 ? "ok" : "idle"}
          primary={`${compact.format(health.aiTokens)} tokens`}
          secondary={`${health.aiRequests.toLocaleString()} requests`}
        />
        <HealthTile
          to="/admin/insights/analytics"
          label="Site errors · 24h"
          tone={health.siteErrors24h > 0 ? "warn" : "ok"}
          primary={String(health.siteErrors24h)}
          secondary="Client errors reported"
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="attention-title" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 id="attention-title" className={sectionTitle}>
                Needs attention
              </h2>
              <span className="text-sm text-os-muted">{attention.length} open</span>
            </div>
            {attention.length === 0 ? (
              <p className={cn(panel, "px-6 py-10 text-center text-sm text-os-muted")}>
                Nothing needs attention. No failed messages and no failing jobs.
              </p>
            ) : (
              <ul className={cn(panel, "divide-y divide-os-container/70")}>
                {attention.map((item) => {
                  const Icon = item.severity === "red" ? AlertCircle : AlertTriangle;
                  return (
                    <li key={item.key} className="flex items-start gap-4 p-5 sm:p-6">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-os-item",
                          item.severity === "red" ? "bg-destructive/15 text-destructive" : "bg-os-amber/15 text-os-amber",
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{item.title}</p>
                        <p className="mt-1 break-words text-sm text-os-grey">{item.detail}</p>
                        <p className="mt-2 text-xs text-os-muted">{item.where}</p>
                      </div>
                      <Link to={item.to} className={cn(actionBtn(), "shrink-0")}>
                        {item.action}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="senders-title" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 id="senders-title" className={sectionTitle}>
                Email senders
              </h2>
              <Link
                to="/admin/messaging/senders"
                className="inline-flex items-center gap-1 text-sm text-os-accent transition-colors hover:text-os-accent-hover"
              >
                Configure <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <ul className={cn(panel, "divide-y divide-os-container/70")}>
              {senders.map((s) => (
                <li key={s.purpose} className="grid items-center gap-3 px-6 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <span className="font-semibold text-foreground">{s.label}</span>
                  <UsageGauge value={s.today} max={s.connected ? s.cap : null} />
                  <span className="text-sm tabular-nums text-os-grey">
                    {!s.connected ? "Off" : s.cap ? `${s.today.toLocaleString()} / ${s.cap.toLocaleString()} today` : `${s.today.toLocaleString()} today`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="activity-title" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="activity-title" className={sectionTitle}>
              Recent activity
            </h2>
            <Link
              to="/admin/insights/audit-log"
              className="inline-flex items-center gap-1 text-sm text-os-accent transition-colors hover:text-os-accent-hover"
            >
              Audit log <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className={cn(panel, "px-6 py-10 text-center text-sm text-os-muted")}>No recent activity.</p>
          ) : (
            <ol className={cn(panel, "flex flex-col p-3")}>
              {recent.map((e) => (
                <li key={e.id} className="flex items-start gap-3 rounded-os-item px-3 py-3">
                  <AuditActorAvatar actor={e.actor} actorId={e.actorId} />
                  <div className="min-w-0 flex-1 text-sm leading-snug">
                    <p className="text-os-grey">
                      <AuditActorName actor={e.actor} actorId={e.actorId} />{" "}
                      <span className="font-mono text-xs">{e.action}</span>
                      {e.target && (
                        <>
                          {" "}
                          <span className="text-foreground">{e.target}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-os-muted">{ago(e.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
