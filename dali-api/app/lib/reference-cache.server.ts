import { prisma } from "~/lib/db.server";
import { cachedForTtl, clearTtlCache } from "~/lib/ttl-cache";
import { publish, subscribe } from "~/lib/realtime-bus.server";
import { onDbOperation } from "~/lib/db-write-hooks";
import { WRITE_OPERATIONS } from "~/lib/layout-cache.server";

export const REFERENCE_CACHE_TTL_MS = 5 * 60_000;

const TOPIC = "reference-cache";

export type ReferenceTable = "Term" | "Domain" | "GroupDefinition";
const TABLES: ReadonlySet<string> = new Set<ReferenceTable>(["Term", "Domain", "GroupDefinition"]);

const keyFor = (table: ReferenceTable) => `reference:${table}`;

// The current-term lookups ("term:current", ...) derive from Term rows, so a
// Term write clears them along with the table.
function clearLocal(table: ReferenceTable): void {
  clearTtlCache(keyFor(table));
  if (table === "Term") clearTtlCache("term:");
}

function clearAllLocal(): void {
  clearTtlCache("reference:");
  clearTtlCache("term:");
}

const g = globalThis as unknown as { __referenceCacheListening?: boolean };
function listen(): void {
  if (g.__referenceCacheListening) return;
  g.__referenceCacheListening = true;
  subscribe(TOPIC, (event, data) => {
    // A sync means invalidations may have been lost while Redis was down.
    if (event === "sync" || !data || !TABLES.has(data)) return clearAllLocal();
    clearLocal(data as ReferenceTable);
  });
}

const pending = new Set<ReferenceTable>();
function flush(): void {
  const tables = [...pending];
  pending.clear();
  for (const table of tables) publish(TOPIC, table);
}

/** Clear `table` here now and on every other machine (once per table per tick). */
export function invalidateReferenceCache(table: ReferenceTable): void {
  listen();
  clearLocal(table);
  if (pending.size === 0) setImmediate(flush);
  pending.add(table);
}

export function invalidateReferenceCacheForWrite(model: string | undefined, operation: string): void {
  if (!model || !TABLES.has(model) || !WRITE_OPERATIONS.has(operation)) return;
  invalidateReferenceCache(model as ReferenceTable);
}

onDbOperation("reference-cache", invalidateReferenceCacheForWrite);

// Dates and arrays are mutable, so callers get their own copy of each row.
function copyRow<T extends object>(row: T): T {
  const copy: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    copy[field] = value instanceof Date ? new Date(value) : Array.isArray(value) ? [...value] : value;
  }
  return copy as T;
}

async function cachedTable<T extends object>(table: ReferenceTable, read: () => Promise<T[]>): Promise<T[]> {
  listen();
  return (await cachedForTtl(keyFor(table), REFERENCE_CACHE_TTL_MS, read)).map(copyRow);
}

/** Every term, newest first (`orderBy sortKey desc`). */
export const cachedTerms = () => cachedTable("Term", () => prisma.term.findMany({ orderBy: { sortKey: "desc" } }));

/** Every domain, by display name (`orderBy displayName asc`). */
export const cachedDomains = () =>
  cachedTable("Domain", () => prisma.domain.findMany({ orderBy: { displayName: "asc" } }));

/** Every group definition, by name (`orderBy name asc`). Membership is never cached here. */
export const cachedGroupDefinitions = () =>
  cachedTable("GroupDefinition", () => prisma.groupDefinition.findMany({ orderBy: { name: "asc" } }));
