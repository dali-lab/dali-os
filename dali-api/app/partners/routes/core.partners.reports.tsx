import { useMemo, useState, type ReactNode } from "react";
import { Link, redirect, useLoaderData, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/core.partners.reports";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { Popover, Select } from "~/components/ui/floating";
import { OS_PANEL_CLASS } from "~/components/ui/floating/styles";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { formatUsd } from "~/lib/money";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import {
  resolveReportsTerm,
  loadFunnelSection,
  loadCycleTimeSection,
  loadRejectionReasonsSection,
  loadPartnerMixSection,
  loadRevenueSection,
  type ReportApplication,
} from "../lib/partner-reports.server";
import {
  barPercent,
  computeFunnelSteps,
  formatFunnelValue,
  formatMedianDays,
  reportSourceHref,
  splitPercent,
  topWithRemainder,
} from "../lib/partner-reports";
import { PARTNER_STAGE_LABELS, PARTNER_REJECT_REASON_LABELS } from "../lib/partner-application";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner reports · DALI OS" }];

const SOURCE_LABELS: Record<string, string> = {
  Email: "Email",
  Form: "Apply form",
  Referral: "Referral",
  Manual: "Manual",
  Renewal: "Renewal",
};

const FEE_ROWS_SHOWN = 5;
const POPOVER_ROWS_SHOWN = 6;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const termContext = await resolveReportsTerm(url.searchParams.get("term"));
  const { selectedTermId } = termContext;

  const [funnelSection, cycleTime, rejectionReasons, partnerMix, revenue] = await Promise.all([
    loadFunnelSection(selectedTermId),
    loadCycleTimeSection(selectedTermId),
    loadRejectionReasonsSection(selectedTermId),
    loadPartnerMixSection(selectedTermId),
    loadRevenueSection(selectedTermId),
  ]);

  return {
    terms: termContext.terms,
    selectedTermId,
    funnel: funnelSection.funnel,
    reached: funnelSection.reached,
    bySource: funnelSection.bySource,
    applications: funnelSection.applications,
    cycleTime,
    rejectionReasons,
    partnerMix,
    revenue,
  };
}

const ROW_BASE =
  "grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm";
const ROW_CLICKABLE =
  "transition-colors hover:bg-os-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent";

function Panel({
  title,
  caption,
  right,
  children,
}: {
  title: string;
  caption?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const os = useOsChrome();
  return (
    <section className={cn(os.panel, "flex flex-col gap-3 p-5")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={os.sectionTitle}>{title}</h2>
        {right && <span className="text-sm font-semibold tabular-nums text-foreground">{right}</span>}
      </div>
      {children}
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function BarContent({
  label,
  value,
  percent,
  hint,
}: {
  label: string;
  value: string;
  percent: number;
  hint?: ReactNode;
}) {
  return (
    <>
      <span className="truncate text-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-os-well" aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, background: "var(--color-os-accent)" }}
        />
      </span>
      <span className="flex items-center justify-end gap-2 whitespace-nowrap tabular-nums text-foreground">
        {hint}
        {value}
      </span>
    </>
  );
}

function StaticBar(props: { label: string; value: string; percent: number }) {
  return (
    <div className={ROW_BASE}>
      <BarContent {...props} />
    </div>
  );
}

function ApplicationList({
  ids,
  applications,
  close,
}: {
  ids: string[];
  applications: Map<string, ReportApplication>;
  close: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = ids.map((id) => applications.get(id)).filter((a): a is ReportApplication => !!a);
  const shown = showAll ? rows : rows.slice(0, POPOVER_ROWS_SHOWN);
  return (
    <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
      {shown.map((a) => (
        <Link
          key={a.id}
          to={`/core/partners?application=${a.id}`}
          onClick={close}
          className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-os-hover"
        >
          <span className="min-w-0 truncate text-foreground">
            {a.title}
            {a.orgName && <span className="text-muted-foreground"> · {a.orgName}</span>}
          </span>
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            {PARTNER_STAGE_LABELS[a.stage]}
          </span>
        </Link>
      ))}
      {!showAll && rows.length > POPOVER_ROWS_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-md px-2 py-1.5 text-left text-sm text-os-accent hover:bg-os-hover"
        >
          Show all {rows.length}
        </button>
      )}
    </div>
  );
}

function BucketBar({
  label,
  value,
  percent,
  ids,
  applications,
}: {
  label: string;
  value: string;
  percent: number;
  ids: string[];
  applications: Map<string, ReportApplication>;
}) {
  if (ids.length === 0) return <StaticBar label={label} value={value} percent={percent} />;
  return (
    <Popover
      align="left"
      ariaLabel={`${label} applications`}
      panelClassName={cn(OS_PANEL_CLASS, "w-96 max-w-[90vw] p-2")}
      trigger={
        <button type="button" className={cn(ROW_BASE, ROW_CLICKABLE)}>
          <BarContent label={label} value={value} percent={percent} />
        </button>
      }
    >
      {(close) => <ApplicationList ids={ids} applications={applications} close={close} />}
    </Popover>
  );
}

export default function PartnerReports() {
  const {
    terms,
    selectedTermId,
    funnel,
    reached,
    bySource,
    applications,
    cycleTime,
    rejectionReasons,
    partnerMix,
    revenue,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const [showAllFees, setShowAllFees] = useState(false);

  const appById = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications]);
  const steps = computeFunnelSteps(reached);
  const funnelMax = Math.max(...steps.map((s) => s.count), 0);
  const sourceMax = Math.max(...bySource.map((r) => r.count), 0);
  const rejectionMax = Math.max(...rejectionReasons.map((r) => r.count), 0);
  const [newPercent, returningPercent] = splitPercent(partnerMix.newCount, partnerMix.returningCount);
  const fees = topWithRemainder(revenue, FEE_ROWS_SHOWN);
  const feeRows = showAllFees ? revenue : fees.top;
  const feeMax = Math.max(...revenue.map((r) => r.totalCents), 0);
  const feeTotal = revenue.reduce((sum, r) => sum + r.totalCents, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Reports</h1>
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <PartnerCrmNav className="shrink-0 self-start md:self-center" />
        <div className="flex-1" />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Funnel" caption="Percent is the share of the stage before.">
          {funnel.total === 0 ? (
            <Empty>No applications in this window.</Empty>
          ) : (
            <div className="flex flex-col">
              {steps.map((step) => (
                <BucketBar
                  key={step.key}
                  label={step.label}
                  value={formatFunnelValue(step)}
                  percent={barPercent(step.count, funnelMax)}
                  ids={step.ids}
                  applications={appById}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Where applications came from">
          {bySource.length === 0 ? (
            <Empty>No applications in this window.</Empty>
          ) : (
            <div className="flex flex-col">
              {bySource.map((row) => (
                <Link
                  key={row.source}
                  to={reportSourceHref(row.source, selectedTermId)}
                  className={cn(ROW_BASE, ROW_CLICKABLE, "group")}
                >
                  <BarContent
                    label={SOURCE_LABELS[row.source] ?? row.source}
                    value={String(row.count)}
                    percent={barPercent(row.count, sourceMax)}
                    hint={
                      <span className="text-xs text-os-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        Open →
                      </span>
                    }
                  />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Time to decision">
          <div className="flex flex-col divide-y divide-os-container/70">
            {[
              {
                label: "Applied to accepted",
                days: cycleTime.medianToAcceptedDays,
                n: cycleTime.sampleSize.toAccepted,
              },
              {
                label: "Accepted to project created",
                days: cycleTime.medianToProjectDays,
                n: cycleTime.sampleSize.toProject,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 px-2 py-2.5">
                <span className="text-sm text-foreground">{row.label}</span>
                <span className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatMedianDays(row.days)}
                  </span>
                  <span className="block text-xs text-muted-foreground">median of {row.n}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Why applications were rejected">
          {rejectionReasons.length === 0 ? (
            <Empty>No rejections in this window.</Empty>
          ) : (
            <div className="flex flex-col">
              {rejectionReasons.map((row) => (
                <BucketBar
                  key={row.reason}
                  label={PARTNER_REJECT_REASON_LABELS[row.reason]}
                  value={String(row.count)}
                  percent={barPercent(row.count, rejectionMax)}
                  ids={row.ids}
                  applications={appById}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="New and returning partners">
          {partnerMix.newCount + partnerMix.returningCount === 0 ? (
            <Empty>No partners in this window.</Empty>
          ) : (
            <div className="flex flex-col gap-3 px-2">
              <div className="flex h-2 overflow-hidden rounded-full bg-os-well" aria-hidden>
                <span
                  className="h-full"
                  style={{ width: `${newPercent}%`, background: "var(--color-os-accent)" }}
                />
                <span
                  className="h-full"
                  style={{
                    width: `${returningPercent}%`,
                    background: "color-mix(in srgb, var(--color-os-accent) 40%, transparent)",
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-2 text-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "var(--color-os-accent)" }}
                    aria-hidden
                  />
                  New <span className="tabular-nums">{partnerMix.newCount}</span>
                </span>
                <span className="inline-flex items-center gap-2 text-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: "color-mix(in srgb, var(--color-os-accent) 40%, transparent)",
                    }}
                    aria-hidden
                  />
                  Returning <span className="tabular-nums">{partnerMix.returningCount}</span>
                </span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Fees by organization" right={revenue.length > 0 ? formatUsd(feeTotal / 100) : undefined}>
          {revenue.length === 0 ? (
            <Empty>No issued or paid invoices in this window.</Empty>
          ) : (
            <div className="flex flex-col">
              {feeRows.map((row) => (
                <Link
                  key={row.orgId}
                  to={`/core/partners/orgs/${row.orgId}`}
                  className={cn(ROW_BASE, ROW_CLICKABLE)}
                >
                  <BarContent
                    label={row.orgName}
                    value={formatUsd(row.totalCents / 100)}
                    percent={barPercent(row.totalCents, feeMax)}
                  />
                </Link>
              ))}
              {!showAllFees && fees.moreCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllFees(true)}
                  className="rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-os-card-hover hover:text-foreground"
                >
                  + {fees.moreCount} more, {formatUsd(fees.moreCents / 100)}
                </button>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
