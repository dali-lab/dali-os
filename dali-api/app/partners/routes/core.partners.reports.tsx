// Partner CRM reports (specs/partner-crm.md §12): funnel, cycle time,
// rejection reasons, partner mix, capacity, and revenue (behind
// `partner-finance`). The loader does the queries (partner-reports.server.ts);
// the math is pure and unit-tested in partner-reports.ts.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSearchParams, useSubmit, useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/core.partners.reports";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { coreHandle } from "~/core/coreNav";
import { Select } from "~/components/ui/floating";
import { Card } from "~/components/ui/Card";
import { formatUsd } from "~/lib/money";
import { useChartColors } from "~/components/analytics/useChartColors";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import {
  resolveReportsTerm,
  loadFunnelSection,
  loadCycleTimeSection,
  loadRejectionReasonsSection,
  loadPartnerMixSection,
  loadCapacitySection,
  loadRevenueSection,
} from "../lib/partner-reports.server";
import {
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  PARTNER_REJECT_REASON_LABELS,
} from "../lib/partner-application";

export const handle = { ...coreHandle("partners"), areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner reports · DALI OS" }];

const SOURCE_LABELS: Record<string, string> = {
  Email: "Email",
  Form: "Apply form",
  Referral: "Referral",
  Manual: "Manual",
  Renewal: "Renewal",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const termParam = url.searchParams.get("term");
  const termContext = await resolveReportsTerm(termParam);
  const { selectedTermId } = termContext;

  const roles = await getUserRoles(auth.user.sub, request);
  const financeEnabled = await isFeatureEnabled("partner-finance", auth.user.sub, roles, request);

  const [funnelSection, cycleTime, rejectionReasons, partnerMix, capacity, revenue] = await Promise.all([
    loadFunnelSection(selectedTermId),
    loadCycleTimeSection(selectedTermId),
    loadRejectionReasonsSection(selectedTermId),
    loadPartnerMixSection(selectedTermId),
    loadCapacitySection(selectedTermId),
    financeEnabled ? loadRevenueSection(selectedTermId) : Promise.resolve([]),
  ]);

  return {
    terms: termContext.terms,
    selectedTermId,
    funnel: funnelSection.funnel,
    bySource: funnelSection.bySource,
    cycleTime,
    rejectionReasons,
    partnerMix,
    capacity,
    revenue,
    financeEnabled,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function StatTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold text-foreground tabular-nums">{value}</div>
      {caption && <div className="text-[11px] text-muted-foreground/70">{caption}</div>}
    </Card>
  );
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-foreground)",
  },
  labelStyle: { color: "var(--color-foreground)" },
  itemStyle: { color: "var(--color-foreground)" },
};

export default function PartnerReports() {
  const {
    terms,
    selectedTermId,
    funnel,
    bySource,
    cycleTime,
    rejectionReasons,
    partnerMix,
    capacity,
    revenue,
    financeEnabled,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const colors = useChartColors();

  const funnelData = PARTNER_STAGES.map((stage) => ({
    stage: PARTNER_STAGE_LABELS[stage],
    count: funnel.stageCounts[stage],
  }));
  const sourceData = bySource.map((r) => ({
    source: SOURCE_LABELS[r.source] ?? r.source,
    count: r.count,
  }));
  const rejectionData = rejectionReasons.map((r) => ({
    reason: PARTNER_REJECT_REASON_LABELS[r.reason],
    count: r.count,
  }));
  const mixData = [
    { label: "New", count: partnerMix.newCount },
    { label: "Returning", count: partnerMix.returningCount },
  ];
  const capacityData = capacity.map((c) => ({
    domain: c.domainName,
    Expected: c.expected,
    Staffed: c.staffed,
  }));
  const revenueData = revenue.map((r) => ({ org: r.orgName, dollars: r.totalCents / 100 }));

  return (
    <div className="flex flex-col gap-6">
      <PartnerCrmNav />
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-foreground text-4xl font-medium">Reports</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Term</label>
          <Select
            value={selectedTermId ?? "all"}
            ariaLabel="Term"
            options={[
              { value: "all", label: "All time" },
              ...terms.map((t) => ({ value: t.id, label: t.code })),
            ]}
            onChange={(value) => {
              const params = new URLSearchParams(searchParams);
              params.set("term", value);
              submit(params, { method: "get" });
            }}
          />
        </div>
      </header>

      {/* ── Funnel ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Funnel</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Applications" value={String(funnel.total)} />
          <StatTile
            label="New → Interview"
            value={funnel.newToInterviewRate !== null ? `${Math.round(funnel.newToInterviewRate * 100)}%` : "—"}
            caption="ever reached Interview"
          />
          <StatTile
            label="Interview → Accepted"
            value={
              funnel.interviewToAcceptedRate !== null
                ? `${Math.round(funnel.interviewToAcceptedRate * 100)}%`
                : "—"
            }
            caption="of those interviewed"
          />
          <StatTile label="Accepted" value={String(funnel.stageCounts.Accepted)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground mb-2">By stage</p>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={colors.teal} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground mb-2">By source</p>
            <div className="w-full h-64">
              {sourceData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No applications in this window.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceData} layout="vertical" margin={{ left: 12, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                    <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="count" fill={colors.coral} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* ── Cycle time ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Cycle time</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatTile
            label="Created → Accepted"
            value={cycleTime.medianToAcceptedDays !== null ? `${round1(cycleTime.medianToAcceptedDays)} days` : "—"}
            caption={`median · ${cycleTime.sampleSize.toAccepted} application${cycleTime.sampleSize.toAccepted === 1 ? "" : "s"}`}
          />
          <StatTile
            label="Created → project"
            value={cycleTime.medianToProjectDays !== null ? `${round1(cycleTime.medianToProjectDays)} days` : "—"}
            caption={`median · ${cycleTime.sampleSize.toProject} application${cycleTime.sampleSize.toProject === 1 ? "" : "s"}`}
          />
        </div>
      </section>

      {/* ── Rejection reasons ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Rejection reasons</h2>
        <Card className="p-4">
          <div className="w-full h-64">
            {rejectionData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No rejections in this window.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rejectionData} layout="vertical" margin={{ left: 12, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <YAxis type="category" dataKey="reason" width={130} tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={colors.yellow} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </section>

      {/* ── Partner mix ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Partner mix</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <StatTile label="New orgs" value={String(partnerMix.newCount)} />
            <StatTile label="Returning orgs" value={String(partnerMix.returningCount)} />
          </div>
          <Card className="p-4">
            <div className="w-full h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mixData} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={colors.green} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </section>

      {/* ── Capacity ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Capacity</h2>
        <p className="text-sm text-muted-foreground">
          Projected headcount from open applications without a project yet, versus members already staffed,
          by domain.
        </p>
        <Card className="p-4">
          <div className="w-full h-72">
            {capacityData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                {selectedTermId ? "No capacity data for this term." : "Pick a term to see capacity."}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={capacityData} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="domain" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Expected" fill={colors.coral} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Staffed" fill={colors.teal} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </section>

      {/* ── Revenue (partner-finance only) ─────────────────────────────── */}
      {financeEnabled && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-foreground">Revenue by org</h2>
          <Card className="p-4">
            <div className="w-full h-64">
              {revenueData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No issued or paid invoices in this window.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData} layout="vertical" margin={{ left: 12, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatUsd(v)}
                      tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                    />
                    <YAxis type="category" dataKey="org" width={140} tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                    <Tooltip {...tooltipStyle} formatter={((v: number) => formatUsd(v)) as any} />
                    <Bar dataKey="dollars" fill={colors.pink} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
