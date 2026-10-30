// Pure aggregation for /core/partners/reports (specs/partner-crm.md §12). No
// prisma here — partner-reports.server.ts does the queries and hands these
// functions plain rows, so the math is unit-testable without a database.

import type {
  PartnerActivityType,
  PartnerApplicationSource,
  PartnerInvoiceStatus,
  PartnerRejectReason,
  PartnerStage,
} from "~/generated/prisma/enums";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Funnel ───────────────────────────────────────────────────────────────

export type FunnelInputApp = { id: string; stage: PartnerStage };
export type FunnelStatusChange = { applicationId: string; to: PartnerStage };

export type FunnelResult = {
  stageCounts: Record<PartnerStage, number>;
  total: number;
  newToInterviewRate: number | null;
  interviewToAcceptedRate: number | null;
};

export type FunnelReached = { applied: string[]; interview: string[]; accepted: string[] };

const INTERVIEW_OR_LATER: PartnerStage[] = ["Interview", "Deciding", "Accepted"];

/** Every stage an application has ever been in: its current stage, "New" (the
 *  implicit start of every card), plus every stage named in a StatusChanged
 *  activity's `to`. */
function stagesEverReached(
  apps: FunnelInputApp[],
  statusChanges: FunnelStatusChange[],
): Map<string, Set<PartnerStage>> {
  const reached = new Map<string, Set<PartnerStage>>();
  for (const a of apps) reached.set(a.id, new Set<PartnerStage>(["New", a.stage]));
  for (const sc of statusChanges) {
    reached.get(sc.applicationId)?.add(sc.to);
  }
  return reached;
}

export function computeFunnelReached(
  apps: FunnelInputApp[],
  statusChanges: FunnelStatusChange[],
): FunnelReached {
  const reached = stagesEverReached(apps, statusChanges);
  const interview: string[] = [];
  const accepted: string[] = [];
  for (const a of apps) {
    const set = reached.get(a.id);
    if (!set) continue;
    if (INTERVIEW_OR_LATER.some((stage) => set.has(stage))) interview.push(a.id);
    if (set.has("Accepted")) accepted.push(a.id);
  }
  return { applied: apps.map((a) => a.id), interview, accepted };
}

export function computeFunnel(
  apps: FunnelInputApp[],
  statusChanges: FunnelStatusChange[],
): FunnelResult {
  const stageCounts: Record<PartnerStage, number> = {
    Backlog: 0,
    New: 0,
    Interview: 0,
    Deciding: 0,
    Accepted: 0,
    Rejected: 0,
  };
  for (const a of apps) stageCounts[a.stage] += 1;
  const { interview, accepted } = computeFunnelReached(apps, statusChanges);
  return {
    stageCounts,
    total: apps.length,
    newToInterviewRate: apps.length > 0 ? interview.length / apps.length : null,
    interviewToAcceptedRate: interview.length > 0 ? accepted.length / interview.length : null,
  };
}

export type FunnelBySourceRow = { source: PartnerApplicationSource; count: number };

export function computeFunnelBySource(
  apps: { source: PartnerApplicationSource }[],
): FunnelBySourceRow[] {
  const counts = new Map<PartnerApplicationSource, number>();
  for (const a of apps) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Cycle time ───────────────────────────────────────────────────────────

export type CycleTimeActivity = {
  applicationId: string | null;
  type: PartnerActivityType;
  createdAt: Date | string;
  metadata: unknown;
};

export type CycleTimeResult = {
  medianToAcceptedDays: number | null;
  medianToProjectDays: number | null;
  sampleSize: { toAccepted: number; toProject: number };
};

function metaField(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== "object") return undefined;
  return (metadata as Record<string, unknown>)[key];
}

/**
 * Median days Created -> Accepted and Created -> project, read off
 * PartnerActivity rows: the earliest `Created` row per application, the
 * earliest `StatusChanged` row whose metadata.to is "Accepted", and among
 * those, the earliest one that also carries a `projectId` (the promote
 * transition — see setApplicationStage's `meta` param). An application missing
 * either event is skipped for that metric rather than treated as zero; a card
 * accepted but never promoted to a project correctly has no
 * Created->project sample.
 */
export function computeCycleTimes(activities: CycleTimeActivity[]): CycleTimeResult {
  const byApp = new Map<string, CycleTimeActivity[]>();
  for (const row of activities) {
    if (!row.applicationId) continue;
    const list = byApp.get(row.applicationId);
    if (list) list.push(row);
    else byApp.set(row.applicationId, [row]);
  }

  const toAcceptedDays: number[] = [];
  const toProjectDays: number[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (const rows of byApp.values()) {
    const createdTimes = rows
      .filter((r) => r.type === "Created")
      .map((r) => new Date(r.createdAt).getTime())
      .sort((a, b) => a - b);
    const created = createdTimes[0];
    if (created === undefined) continue;

    const acceptedRows = rows.filter(
      (r) => r.type === "StatusChanged" && metaField(r.metadata, "to") === "Accepted",
    );
    const acceptedTimes = acceptedRows
      .map((r) => new Date(r.createdAt).getTime())
      .sort((a, b) => a - b);
    if (acceptedTimes[0] !== undefined) {
      toAcceptedDays.push((acceptedTimes[0] - created) / DAY_MS);
    }

    const projectTimes = acceptedRows
      .filter((r) => metaField(r.metadata, "projectId"))
      .map((r) => new Date(r.createdAt).getTime())
      .sort((a, b) => a - b);
    if (projectTimes[0] !== undefined) {
      toProjectDays.push((projectTimes[0] - created) / DAY_MS);
    }
  }

  return {
    medianToAcceptedDays: median(toAcceptedDays),
    medianToProjectDays: median(toProjectDays),
    sampleSize: { toAccepted: toAcceptedDays.length, toProject: toProjectDays.length },
  };
}

// ─── Rejection reasons ────────────────────────────────────────────────────

export type RejectionReasonRow = { reason: PartnerRejectReason; count: number; ids: string[] };

export function computeRejectionReasons(
  apps: { id: string; rejectReason: PartnerRejectReason | null }[],
): RejectionReasonRow[] {
  const byReason = new Map<PartnerRejectReason, string[]>();
  for (const a of apps) {
    if (!a.rejectReason) continue;
    const ids = byReason.get(a.rejectReason);
    if (ids) ids.push(a.id);
    else byReason.set(a.rejectReason, [a.id]);
  }
  return [...byReason.entries()]
    .map(([reason, ids]) => ({ reason, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count);
}

// ─── Partner mix (new vs. returning) ─────────────────────────────────────

export type OrgProjectLink = { startedAt: Date | string | null };

/**
 * An org is "returning" when it has more than one ProjectPartner link and
 * the earliest of them predates the term's start (it was already a partner
 * before this term). With no `termStart` (the "All time" view), two or more
 * links at all is enough — there's no term boundary to compare against.
 */
export function isReturningOrg(links: OrgProjectLink[], termStart?: Date | null): boolean {
  if (links.length < 2) return false;
  if (!termStart) return true;
  const earliest = Math.min(
    ...links.map((l) => (l.startedAt ? new Date(l.startedAt).getTime() : 0)),
  );
  return earliest < termStart.getTime();
}

export type PartnerMixOrg = { orgId: string; orgName: string; links: OrgProjectLink[] };

export type PartnerMixResult = {
  newCount: number;
  returningCount: number;
  newOrgs: { orgId: string; orgName: string }[];
  returningOrgs: { orgId: string; orgName: string }[];
};

export function computePartnerMix(orgs: PartnerMixOrg[], termStart?: Date | null): PartnerMixResult {
  const newOrgs: { orgId: string; orgName: string }[] = [];
  const returningOrgs: { orgId: string; orgName: string }[] = [];
  for (const org of orgs) {
    const entry = { orgId: org.orgId, orgName: org.orgName };
    if (isReturningOrg(org.links, termStart)) returningOrgs.push(entry);
    else newOrgs.push(entry);
  }
  return {
    newCount: newOrgs.length,
    returningCount: returningOrgs.length,
    newOrgs,
    returningOrgs,
  };
}

// ─── Revenue by org ───────────────────────────────────────────────────────

export type RevenueInvoiceRow = {
  orgId: string;
  orgName: string;
  amountCents: number;
  status: PartnerInvoiceStatus;
};

export type RevenueRow = { orgId: string; orgName: string; totalCents: number };

const REVENUE_STATUSES: PartnerInvoiceStatus[] = ["Paid", "Issued"];

export function computeRevenueByOrg(invoices: RevenueInvoiceRow[]): RevenueRow[] {
  const totals = new Map<string, RevenueRow>();
  for (const inv of invoices) {
    if (!REVENUE_STATUSES.includes(inv.status)) continue;
    const existing = totals.get(inv.orgId);
    if (existing) existing.totalCents += inv.amountCents;
    else totals.set(inv.orgId, { orgId: inv.orgId, orgName: inv.orgName, totalCents: inv.amountCents });
  }
  return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents);
}

// ─── Presentation helpers ────────────────────────────────────────────────

export type FunnelStep = {
  key: "applied" | "interview" | "accepted";
  label: string;
  count: number;
  conversion: number | null;
  ids: string[];
};

export function computeFunnelSteps(reached: FunnelReached): FunnelStep[] {
  const defs = [
    { key: "applied", label: "Applied" },
    { key: "interview", label: "Reached interview" },
    { key: "accepted", label: "Accepted" },
  ] as const;
  return defs.map((def, i) => {
    const ids = reached[def.key];
    const previous = i === 0 ? null : reached[defs[i - 1].key].length;
    return {
      key: def.key,
      label: def.label,
      count: ids.length,
      conversion: previous && previous > 0 ? ids.length / previous : null,
      ids,
    };
  });
}

export function formatFunnelValue(step: Pick<FunnelStep, "count" | "conversion">): string {
  return step.conversion === null
    ? String(step.count)
    : `${step.count} · ${Math.round(step.conversion * 100)}%`;
}

export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(2, (value / max) * 100));
}

export function formatMedianDays(days: number | null): string {
  if (days === null) return "—";
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

export function topWithRemainder<T extends { totalCents: number }>(
  rows: T[],
  limit: number,
): { top: T[]; moreCount: number; moreCents: number } {
  const rest = rows.slice(limit);
  return {
    top: rows.slice(0, limit),
    moreCount: rest.length,
    moreCents: rest.reduce((sum, r) => sum + r.totalCents, 0),
  };
}

export function reportSourceHref(source: string, termId: string | null): string {
  const params = new URLSearchParams({ source });
  if (termId) params.set("term", termId);
  return `/core/partners?${params.toString()}`;
}

export function splitPercent(a: number, b: number): [number, number] {
  const total = a + b;
  if (total === 0) return [0, 0];
  const first = Math.round((a / total) * 100);
  return [first, 100 - first];
}
