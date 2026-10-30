// The one pagination format for MCP reads. Callers always send `limit` + an
// opaque `cursor`, and always read a `page` object back, whether the tool walks
// a keyset, an offset, or characters of one long value. Leaf module: no Prisma
// or registry imports, so tool tests never need the generated client.

import { McpInvalidError } from "./errors";
import type { JsonSchema } from "~/lib/mcp-input";

export type PageInfo = {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  total?: number;
};

export type PageLimits = { defaultLimit: number; maxLimit: number };

export type PageArgs = { limit?: number; cursor?: string };

type CursorBody = { o: number } | { k: (string | number)[] };

function encodeCursor(body: CursorBody): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorBody {
  try {
    const body: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (body && typeof body === "object") {
      const { o, k } = body as { o?: unknown; k?: unknown };
      if (Number.isInteger(o) && (o as number) >= 0) return { o: o as number };
      if (Array.isArray(k)) return { k: k as (string | number)[] };
    }
  } catch {
    // Reported below with the same message as a well-formed but wrong cursor.
  }
  throw new McpInvalidError("Invalid cursor. Pass page.nextCursor from the previous response unchanged.");
}

function resolveLimit(requested: number | undefined, { defaultLimit, maxLimit }: PageLimits): number {
  const n = Math.trunc(Number(requested ?? defaultLimit));
  if (!Number.isFinite(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}

/** Schema properties to spread into a tool's `inputSchema.properties`. */
export function pageProps({ defaultLimit, maxLimit }: PageLimits): Record<string, JsonSchema> {
  return {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: maxLimit,
      description: `Page size (default ${defaultLimit}, max ${maxLimit}).`,
    } as JsonSchema,
    cursor: {
      type: "string",
      description: "Pass page.nextCursor from the previous response to get the next page.",
    } as JsonSchema,
  };
}

// ─── Offset ──────────────────────────────────────────────────────────────────
// For lists sorted on a nullable column, or computed/filtered in memory.

export type OffsetWindow = { limit: number; skip: number; take: number };

/** `skip`/`take` for a Prisma query. `take` overfetches one row to detect more. */
export function offsetWindow(args: PageArgs, limits: PageLimits): OffsetWindow {
  const limit = resolveLimit(args.limit, limits);
  let skip = 0;
  if (args.cursor) {
    const body = decodeCursor(args.cursor);
    if (!("o" in body)) throw new McpInvalidError("Invalid cursor. Pass page.nextCursor from the previous response unchanged.");
    skip = body.o;
  }
  return { limit, skip, take: limit + 1 };
}

/** Trim rows fetched through `offsetWindow` and build the `page` object. */
export function offsetPage<T>(
  rows: T[],
  window: OffsetWindow,
  total?: number,
): { rows: T[]; page: PageInfo } {
  const hasMore = rows.length > window.limit;
  return {
    rows: hasMore ? rows.slice(0, window.limit) : rows,
    page: {
      nextCursor: hasMore ? encodeCursor({ o: window.skip + window.limit }) : null,
      hasMore,
      limit: window.limit,
      ...(total !== undefined ? { total } : {}),
    },
  };
}

/** Page an already-computed list. `total` is always known here. */
export function pageArray<T>(
  all: T[],
  args: PageArgs,
  limits: PageLimits,
): { rows: T[]; page: PageInfo } {
  const window = offsetWindow(args, limits);
  return offsetPage(all.slice(window.skip, window.skip + window.take), window, all.length);
}

// ─── Keyset ──────────────────────────────────────────────────────────────────
// For DB-ordered lists. Stable under concurrent inserts and survives the cursor
// row being deleted, which a Prisma `cursor: { id }` does not. Sort fields must
// be non-null: use offset paging for a nullable column.

export type KeysetField = {
  field: string;
  direction: "asc" | "desc";
  type?: "date" | "string" | "number";
};

export type KeysetWindow = {
  limit: number;
  take: number;
  where: Record<string, unknown>;
  orderBy: Record<string, "asc" | "desc">[];
  sort: KeysetField[];
};

/** `where`/`orderBy`/`take` for a Prisma query. Always tiebreaks on `id`. */
export function keysetWindow(
  args: PageArgs,
  limits: PageLimits,
  sortFields: KeysetField[],
  tiebreakDirection: "asc" | "desc" = "desc",
): KeysetWindow {
  const limit = resolveLimit(args.limit, limits);
  const sort: KeysetField[] = [
    ...sortFields,
    { field: "id", direction: tiebreakDirection, type: "string" },
  ];
  return {
    limit,
    take: limit + 1,
    sort,
    orderBy: sort.map((s) => ({ [s.field]: s.direction })),
    where: args.cursor ? keysetWhere(args.cursor, sort) : {},
  };
}

function keysetWhere(cursor: string, sort: KeysetField[]): Record<string, unknown> {
  const body = decodeCursor(cursor);
  if (!("k" in body) || body.k.length !== sort.length) {
    throw new McpInvalidError("Invalid cursor. Pass page.nextCursor from the previous response unchanged.");
  }
  const values = sort.map((s, i) => {
    const raw = body.k[i];
    if (s.type !== "date") return raw;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new McpInvalidError("Invalid cursor. Pass page.nextCursor from the previous response unchanged.");
    }
    return date;
  });
  return {
    OR: sort.map((s, i) => ({
      ...Object.fromEntries(sort.slice(0, i).map((prev, j) => [prev.field, values[j]])),
      [s.field]: { [s.direction === "desc" ? "lt" : "gt"]: values[i] },
    })),
  };
}

/** Trim rows fetched through `keysetWindow` and build the `page` object. Rows
 *  must carry every sort field, so include them in the query's `select`. */
export function keysetPage<T extends object>(
  rows: T[],
  window: KeysetWindow,
  total?: number,
): { rows: T[]; page: PageInfo } {
  const hasMore = rows.length > window.limit;
  const kept = hasMore ? rows.slice(0, window.limit) : rows;
  const last = kept[kept.length - 1] as Record<string, unknown> | undefined;
  const k = hasMore && last
    ? window.sort.map(({ field }) => {
        const value = last[field];
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "string" || typeof value === "number") return value;
        throw new Error(`keysetPage: sort field "${field}" is missing from the row`);
      })
    : null;
  return {
    rows: kept,
    page: {
      nextCursor: k ? encodeCursor({ k }) : null,
      hasMore,
      limit: window.limit,
      ...(total !== undefined ? { total } : {}),
    },
  };
}

// ─── Text ────────────────────────────────────────────────────────────────────
// For one long value. `limit` is characters and `total` is the full length.

export const TEXT_PAGE_LIMITS: PageLimits = { defaultLimit: 50_000, maxLimit: 200_000 };

/** Slice one chunk of `text`, never splitting a surrogate pair. */
export function pageText(
  text: string,
  args: PageArgs,
  limits: PageLimits = TEXT_PAGE_LIMITS,
): { text: string; page: PageInfo } {
  const { limit, skip } = offsetWindow(args, limits);
  let end = Math.min(skip + limit, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && end - skip > 1 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  const hasMore = end < text.length;
  return {
    text: text.slice(skip, end),
    page: {
      nextCursor: hasMore ? encodeCursor({ o: end }) : null,
      hasMore,
      limit,
      total: text.length,
    },
  };
}
