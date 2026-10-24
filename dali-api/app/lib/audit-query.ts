import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { AUDIT_ACTIONS, AUDIT_AREAS, actionsInArea, type AuditAction } from "~/lib/audit-actions";
import { APPLICATION_TZ, zonedDayEndUtc, zonedDayStartUtc } from "~/lib/timezone";

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
  area: string | null;
  mcpReads: boolean;
  // True only when the caller opted into hiding and no mcpReads=1 override is set.
  hideMcpReads: boolean;
  userId: string | null;
  targetId: string | null;
  person: string | null;
  from: string | null;
  to: string | null;
};

type AuditQueryPrisma = Pick<PrismaClient, "user">;

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
const AREA_SET: ReadonlySet<string> = new Set(AUDIT_AREAS.map((a) => a.value));
const MCP_READ_ACTION = "mcp.tool_read";
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export type ParseAuditOptions = {
  // The HTML viewer hides high-volume MCP reads by default; the JSON API and
  // MCP tool leave this off and return everything.
  hideMcpReads?: boolean;
};

export function parseAuditFilters(
  params: URLSearchParams,
  options: ParseAuditOptions = {},
): AuditFilters {
  const action = clean(params.get("action"));
  const area = clean(params.get("area"));
  const mcpReads = params.get("mcpReads") === "1";
  return {
    action: action && ACTION_SET.has(action) ? (action as AuditAction) : null,
    area: area && AREA_SET.has(area) ? area : null,
    mcpReads,
    hideMcpReads: Boolean(options.hideMcpReads) && !mcpReads,
    userId: clean(params.get("userId")),
    targetId: clean(params.get("targetId")),
    person: clean(params.get("person")),
    from: validDate(params.get("from")),
    to: validDate(params.get("to")),
  };
}

// Date-only values are whole days in the lab zone; full datetimes are exact instants.
function rangeBound(value: string, edge: "start" | "end"): Date {
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return new Date(value);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (edge === "start") return zonedDayStartUtc(y, mo, d, APPLICATION_TZ);
  // zonedDayEndUtc is 23:59:59; extend to the last millisecond of the day.
  return new Date(zonedDayEndUtc(y, mo, d, APPLICATION_TZ).getTime() + 999);
}

// An explicit action or area (even "mcp") overrides the read-hiding default.
function buildActionClause(filters: AuditFilters): Prisma.AuditLogWhereInput["action"] {
  if (filters.action) return filters.action;
  if (filters.area) return { in: actionsInArea(filters.area) };
  return filters.hideMcpReads ? { not: MCP_READ_ACTION } : undefined;
}

export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const action = buildActionClause(filters);
  if (action) where.action = action;
  if (filters.userId) where.userId = filters.userId;
  if (filters.targetId) where.targetId = filters.targetId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: rangeBound(filters.from, "start") } : {}),
      ...(filters.to ? { lte: rangeBound(filters.to, "end") } : {}),
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
  if (filters.area) params.set("area", filters.area);
  if (filters.mcpReads) params.set("mcpReads", "1");
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
      filters.area ||
      filters.mcpReads ||
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

// Regexes rather than node:net — this module reaches the client bundle.
const FULL_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PARTIAL_IPV4 = /^\d{1,3}(\.\d{1,3}){0,2}\.$|^\d{1,3}(\.\d{1,3}){1,2}$/;
const IPV6ISH = /^[0-9a-f]*:[0-9a-f:]*$/i;

// An address matches exactly; a partial one ("129.170." or "129.170") is a
// prefix, so "1.2.3.4" can't also match "1.2.3.45".
export function ipFilter(text: string): Prisma.AuditLogWhereInput | null {
  const q = text.trim().toLowerCase();
  if (FULL_IPV4.test(q)) return { ip: q };
  if (PARTIAL_IPV4.test(q)) return { ip: { startsWith: q } };
  if (IPV6ISH.test(q) && q.length >= 2) return { ip: { startsWith: q } };
  return null;
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

  const ipPatch = ipFilter(filters.person);
  if (ipPatch) return ipPatch;

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
