import type { Prisma } from "~/generated/prisma/client";
import { AUDIT_ACTIONS, type AuditAction } from "~/lib/audit";

// Validated filters for the AuditLog viewer + JSON API. Every supported
// dimension here either hits an index on AuditLog (action, userId, createdAt)
// or is a cheap equality check (targetId). Unknown action strings are
// dropped silently so a stale dropdown value can't crash the loader; invalid
// dates are dropped so a malformed `from=foo` URL just behaves as no filter.

export type AuditFilters = {
  action?: AuditAction;
  userId?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
};

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function trimOrUndefined(raw: string | null): string | undefined {
  if (raw == null) return undefined;
  const v = raw.trim();
  return v.length > 0 ? v : undefined;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const filters: AuditFilters = {};

  const action = params.get("action");
  if (action && ACTION_SET.has(action)) {
    filters.action = action as AuditAction;
  }

  const userId = trimOrUndefined(params.get("userId"));
  if (userId) filters.userId = userId;

  const targetId = trimOrUndefined(params.get("targetId"));
  if (targetId) filters.targetId = targetId;

  const from = parseDate(params.get("from"));
  if (from) filters.from = from;

  const to = parseDate(params.get("to"));
  if (to) filters.to = to;

  return filters;
}

export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.userId) where.userId = filters.userId;
  if (filters.targetId) where.targetId = filters.targetId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  return where;
}

export function hasAnyFilter(filters: AuditFilters): boolean {
  return Boolean(
    filters.action || filters.userId || filters.targetId || filters.from || filters.to,
  );
}
