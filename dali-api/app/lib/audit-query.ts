import type { Prisma } from "~/generated/prisma/client";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type AuditFilters = {
  action?: string;
  userId?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
};

export type AuditCursor = { createdAt: Date; id: string };

export function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

// Cursor format: `<ISO timestamp>_<id>`. Split on the *first* underscore — ISO
// timestamps never contain one, but ids might. Returns null for missing or
// malformed values; the loader silently falls back to the first page.
export function parseCursor(raw: string | null): AuditCursor | null {
  if (!raw) return null;
  const sep = raw.indexOf("_");
  if (sep <= 0) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const createdAt = new Date(ts);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export function encodeCursor(c: AuditCursor): string {
  return `${c.createdAt.toISOString()}_${c.id}`;
}

export function parseFilters(params: URLSearchParams): AuditFilters {
  const out: AuditFilters = {};
  const action = params.get("action");
  if (action) out.action = action;
  const userId = params.get("userId");
  if (userId) out.userId = userId;
  const targetId = params.get("targetId");
  if (targetId) out.targetId = targetId;
  const from = params.get("from");
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) out.from = d;
  }
  const to = params.get("to");
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) out.to = d;
  }
  return out;
}

export function buildAuditWhere(
  filters: AuditFilters,
  cursor: AuditCursor | null,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.userId) where.userId = filters.userId;
  if (filters.targetId) where.targetId = filters.targetId;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }
  if (cursor) {
    // Keyset: order is (createdAt DESC, id DESC). Use id as a tiebreaker so
    // rows sharing a createdAt aren't skipped or duplicated across pages.
    const keyset: Prisma.AuditLogWhereInput = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
    return where.AND ? { AND: [where, keyset] } : { ...where, AND: [keyset] };
  }
  return where;
}
