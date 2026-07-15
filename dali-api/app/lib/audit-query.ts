import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { AUDIT_ACTIONS, type AuditAction } from "~/lib/audit-actions";

// Validated filters for the AuditLog viewer + JSON API.
//
// `person` is the UI's single search box: it answers both "what did X do?"
// and "what was done to X?" by OR-ing a User lookup across the actor
// (userId) and target (targetId) columns. Most audit rows have a null
// targetId, which is why we don't expose a dedicated target box — one
// person field handles both useful questions in a single query.
//
// `userId` / `targetId` stay as direct exact-id filters for programmatic
// callers that already know the id and want a precise lookup.
//
// `parseAuditFilters` + `buildAuditWhere` are pure: no DB, easy to unit-test.
// `resolveAuditTextFilters` is the async layer that handles `person`.

export type AuditFilters = {
  action: AuditAction | null;
  userId: string | null;
  targetId: string | null;
  person: string | null;
  from: string | null;
  to: string | null;
};

type AuditQueryPrisma = Pick<PrismaClient, "user">;

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

// Cuids start with `c` and run 20+ chars of lowercase alphanumerics. Loose
// enough to catch both legacy cuid and cuid2.
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
    person: clean(params.get("person")),
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
  if (filters.person) params.set("person", filters.person);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function hasAnyFilter(filters: AuditFilters): boolean {
  return Boolean(
    filters.action ||
      filters.userId ||
      filters.targetId ||
      filters.person ||
      filters.from ||
      filters.to,
  );
}

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

// Convert the textual `person` filter into a where-clause patch that ORs
// userId / targetId match. Cuid-shaped input short-circuits to an exact id
// match on both columns; anything else goes through a User table lookup.
// An empty match produces a deliberately impossible OR so the query returns
// zero rows rather than the unfiltered table.
export async function resolveAuditTextFilters(
  prisma: AuditQueryPrisma,
  filters: AuditFilters,
): Promise<Prisma.AuditLogWhereInput> {
  if (!filters.person) return {};

  if (looksLikeCuid(filters.person)) {
    return {
      OR: [{ userId: filters.person }, { targetId: filters.person }],
    };
  }

  const ids = await resolveUserIdsByText(prisma, filters.person);
  if (ids.length === 0) {
    return { OR: [{ userId: "__no_match__" }, { targetId: "__no_match__" }] };
  }
  return {
    OR: [{ userId: { in: ids } }, { targetId: { in: ids } }],
  };
}
