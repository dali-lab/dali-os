// Neon's published usage-to-dollar formulas (neon.com/docs/introduction/usage-calculations,
// read 2026-10-25). Estimates only: credits, discounts, tax, and price changes
// never reach the consumption API, so the invoice stays authoritative. Update
// these rates if Neon reprices.

export type NeonRates = {
  computeCuHour: number;
  storageGbMonth: number;
  instantRestoreGbMonth: number;
  snapshotGbMonth: number;
  publicTransferGb: number;
  publicTransferFreeGb: number;
  privateTransferGb: number;
  extraBranchMonth: number;
  includedBranches: number;
};

export const NEON_RATES: Record<string, NeonRates> = {
  launch: {
    computeCuHour: 0.106,
    storageGbMonth: 0.35,
    instantRestoreGbMonth: 0.2,
    snapshotGbMonth: 0.09,
    publicTransferGb: 0.1,
    publicTransferFreeGb: 500,
    privateTransferGb: 0,
    extraBranchMonth: 1.5,
    includedBranches: 10,
  },
  scale: {
    computeCuHour: 0.222,
    storageGbMonth: 0.35,
    instantRestoreGbMonth: 0.2,
    snapshotGbMonth: 0.09,
    publicTransferGb: 0.1,
    publicTransferFreeGb: 500,
    privateTransferGb: 0.01,
    extraBranchMonth: 1.5,
    includedBranches: 25,
  },
};

const BILLING_MONTH_HOURS = 744;
const GB = 1_000_000_000;

export type NeonCostLines = {
  compute: number;
  storage: number;
  instantRestore: number;
  snapshots: number;
  publicTransfer: number;
  privateTransfer: number;
  extraBranches: number;
};

export type NeonCostEstimate = { total: number; lines: NeonCostLines };

/**
 * One Neon project's cost for one monthly bucket. `bucketHours` is how much of
 * the month the bucket covers (elapsed hours for the current month), used to
 * subtract the included branches from the reported branch-hours. The 500 GB
 * transfer allowance is applied per project, as Neon's worked example does.
 */
export function estimateNeonProjectMonth(
  metrics: Record<string, number>,
  plan: string | null | undefined,
  bucketHours: number,
): NeonCostEstimate | null {
  if (plan === "free") return { total: 0, lines: zeroLines() };
  const r = plan ? NEON_RATES[plan] : undefined;
  if (!r) return null;
  const m = (k: string) => metrics[k] ?? 0;
  const extraBranchHours = Math.max(
    0,
    m("extra_branches_month") - (r.includedBranches - 1) * bucketHours,
  );
  const lines: NeonCostLines = {
    compute: (m("compute_unit_seconds") / 3600) * r.computeCuHour,
    storage: ((m("root_branch_bytes_month") + m("child_branch_bytes_month")) / GB) * r.storageGbMonth,
    instantRestore: (m("instant_restore_bytes_month") / GB) * r.instantRestoreGbMonth,
    snapshots: (m("snapshot_storage_bytes_month") / GB) * r.snapshotGbMonth,
    publicTransfer:
      Math.max(0, m("public_network_transfer_bytes") / GB - r.publicTransferFreeGb) * r.publicTransferGb,
    privateTransfer: (m("private_network_transfer_bytes") / GB) * r.privateTransferGb,
    extraBranches: (extraBranchHours / BILLING_MONTH_HOURS) * r.extraBranchMonth,
  };
  const total = Object.values(lines).reduce((a, b) => a + b, 0);
  return { total, lines };
}

function zeroLines(): NeonCostLines {
  return {
    compute: 0,
    storage: 0,
    instantRestore: 0,
    snapshots: 0,
    publicTransfer: 0,
    privateTransfer: 0,
    extraBranches: 0,
  };
}

export function monthStart(d: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}

/** Hours of `month` (a month start) covered by data as of `now`. */
export function bucketHours(month: Date, now: Date): number {
  const end = Math.min(monthStart(month, 1).getTime(), now.getTime());
  return Math.max(0, (end - month.getTime()) / 3_600_000);
}
