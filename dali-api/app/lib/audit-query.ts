import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { AUDIT_ACTIONS, type AuditAction } from "~/lib/audit";

// Minimal prisma surface used by resolveAuditTextFilters — typed as a
// structural subset so tests can supply a vi.fn() without faking the whole
// client.
type AuditQueryPrisma = Pick<PrismaClient, "user">;

// Validated filters for the AuditLog viewer + JSON API.
//
// Two dimensions are id-only (`userId`, `targetId`) — the indexed primitives,
// useful for programmatic callers that already know the id. Two are
// text-search (`actor`, `target`) — the UI surface, auto-detecting whether
// the input is a cuid (exact match) or a name/email (resolved via the User
// table inside the loader, then merged in as a `userId IN (...)` clause that
// still hits the index).
//
// `parseAuditFilters` + `buildAuditWhere` are pure: no DB, easy to unit-test.
// `resolveAuditTextFilters` is the async layer that handles actor/target.

export type AuditFilters = {
  action: AuditAction | null;
  userId: string | null;
  targetId: string | null;
  actor: string | null;
  target: string | null;
  from: string | null;
  to: string | null;
};

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

// Cuids start with `c` and run 20+ chars of lowercase alphanumerics. The
// test is intentionally loose so it catches both legacy cuid and cuid2.
const CUID_RE = /^c[a-z0-9]{20,}$/i;

export function looksLikeCuid(value: string): boolean {
  return CUID_RE.test(value);
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Validates parseability without losing the original string — the form
// needs it back as-is to repopulate the date input.
function validDate(value: string | null): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  return isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const action = clean(params.get("action"));
  return {
    action: action && ACTION_SET.has(action) ? (action as AuditAction) : null,
    userId: clean(params.get("userId")),
    targetId: clean(params.get("targetId")),
    actor: clean(params.get("actor")),
    target: clean(params.get("target")),
    from: validDate(params.get("from")),
    to: validDate(params.get("to")),
  };
}

export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.userId) where.userId = filters.userId;
  if (filters.targetId) where.targetId = filters.targetId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }
  return where;
}

// Re-serialize only the active filters. Pagination links and the "clear"
// affordance use this so URLs don't carry empty `action=` style noise and
// `page=1` is omitted to keep the first page's URL clean.
export function activeFilterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.targetId) params.set("targetId", filters.targetId);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.target) params.set("target", filters.target);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function hasAnyFilter(filters: AuditFilters): boolean {
  return Boolean(
    filters.action ||
      filters.userId ||
      filters.targetId ||
      filters.actor ||
      filters.target ||
      filters.from ||
      filters.to,
  );
}

// Empty-match sentinel: a text search with zero hits should return zero
// audit rows, not the unfiltered table. Using a deliberately unmatchable
// id keeps the where clause valid + indexed without a special case.
const NO_MATCH_ID = "__no_match__";

// Resolve a name/email text query → list of User ids that match. Cheap at
// our scale (~100 users); a heavier deployment would want a Postgres
// trigram index on these columns.
async function resolveUserIdsByText(
  prisma: AuditQueryPrisma,
  query: string,
): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { daliEmail: { contains: query, mode: "insensitive" } },
        { dartmouthEmail: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  return rows.map((r) => r.id);
}

// Convert the textual `actor` / `target` filters into where-clause patches.
// A cuid-shaped value short-circuits to an exact-id filter; anything else
// goes through a User table lookup. Returns the patches separately so the
// loader can merge them on top of buildAuditWhere's pure output without
// reordering precedence (an explicit `userId=` query param still wins).
export async function resolveAuditTextFilters(
  prisma: AuditQueryPrisma,
  filters: AuditFilters,
): Promise<Prisma.AuditLogWhereInput> {
  const patch: Prisma.AuditLogWhereInput = {};

  if (filters.actor && !filters.userId) {
    if (looksLikeCuid(filters.actor)) {
      patch.userId = filters.actor;
    } else {
      const ids = await resolveUserIdsByText(prisma, filters.actor);
      patch.userId = ids.length > 0 ? { in: ids } : NO_MATCH_ID;
    }
  }

  if (filters.target && !filters.targetId) {
    if (looksLikeCuid(filters.target)) {
      patch.targetId = filters.target;
    } else {
      const ids = await resolveUserIdsByText(prisma, filters.target);
      patch.targetId = ids.length > 0 ? { in: ids } : NO_MATCH_ID;
    }
  }

  return patch;
}
