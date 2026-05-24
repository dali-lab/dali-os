import type { Prisma } from "~/generated/prisma/client";
import { AUDIT_ACTIONS, type AuditAction } from "~/lib/audit";

// Parsed, validated filter state for the audit log viewer / API. Each field is
// null when absent or invalid, so a bare request keeps the unfiltered default.
export type AuditFilters = {
  action: AuditAction | null;
  userId: string | null;
  targetId: string | null;
  from: string | null;
  to: string | null;
};

const AUDIT_ACTION_SET = new Set<string>(AUDIT_ACTIONS);

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Keep the original string (so it can repopulate a <input type="date">) but
// only when it parses to a real date; bad input is dropped rather than 400'd.
function validDate(value: string | null): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const action = clean(params.get("action"));
  return {
    action: action && AUDIT_ACTION_SET.has(action) ? (action as AuditAction) : null,
    userId: clean(params.get("userId")),
    targetId: clean(params.get("targetId")),
    from: validDate(params.get("from")),
    to: validDate(params.get("to")),
  };
}

export function buildAuditWhere(params: URLSearchParams): Prisma.AuditLogWhereInput {
  const filters = parseAuditFilters(params);
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.action) where.action = filters.action;
  if (filters.userId) where.userId = filters.userId;
  if (filters.targetId) where.targetId = filters.targetId;

  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(filters.from);
    if (filters.to) createdAt.lte = new Date(filters.to);
    where.createdAt = createdAt;
  }

  return where;
}

// Re-serialize only the active filters, so pagination links and the "clear"
// affordance can carry the current filter state without leaking empty params.
export function activeFilterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.targetId) params.set("targetId", filters.targetId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function hasActiveFilters(filters: AuditFilters): boolean {
  return (
    filters.action !== null ||
    filters.userId !== null ||
    filters.targetId !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}
