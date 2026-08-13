import type { AuthUser } from "~/lib/auth";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { rowsToCsv, csvResponse } from "~/lib/csv";

// Generalized CSV export mechanism. Each table registers one definition
// (columns/rows + its own authorize check) instead of a bespoke resource
// route; the generic route in app/routes/api.export.$exportId.export.csv.ts
// looks the definition up by id and runs it. See feature-area
// `*/lib/csv-exports.server.ts` files for registrations.
//
// SECURITY: `authorize` must replicate the same scoping the table's own page
// loader applies (e.g. a hiring domain lead only sees their domain on
// /hiring/domain-lead — the export for that table must enforce the same
// restriction, not just gate on "is a domain lead somewhere"). There is no
// default-allow path: authorize() must return true explicitly, and rows()
// is never called otherwise.

export interface CsvExportContext {
  request: Request;
  params: Readonly<Record<string, string | undefined>>;
  searchParams: URLSearchParams;
  user: AuthUser;
}

export interface CsvExportDefinition {
  /** Unique id, used as the :exportId route param. */
  id: string;
  filename: (ctx: CsvExportContext) => string;
  /** Must return true explicitly to proceed — default is deny. */
  authorize: (ctx: CsvExportContext) => Promise<boolean>;
  /** First row should be the header row. */
  rows: (ctx: CsvExportContext) => Promise<unknown[][]>;
}

const registry = new Map<string, CsvExportDefinition>();

export function defineCsvExport(def: CsvExportDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`CSV export "${def.id}" is already registered`);
  }
  registry.set(def.id, def);
}

export async function runCsvExport(
  id: string,
  request: Request,
  params: Readonly<Record<string, string | undefined>>,
): Promise<Response> {
  // Dynamic, not a top-level import: the registration barrel's leaves import
  // defineCsvExport from this module, so a static import here would be a cycle
  // and `registry` below would still be in its TDZ when they register. Loading
  // it on first call means this module is fully evaluated by then. Must also
  // stay inside this function (not the route module) so React Router's
  // dot-server plugin strips it from the client bundle along with the loader.
  await import("~/lib/csv-exports.server");

  const def = registry.get(id);
  if (!def) return new Response("Unknown export", { status: 404 });

  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const ctx: CsvExportContext = {
    request,
    params,
    searchParams: new URL(request.url).searchParams,
    user: auth.user,
  };

  const allowed = await def.authorize(ctx);
  if (allowed !== true) return forbidden(request);

  const rows = await def.rows(ctx);
  const csv = rowsToCsv(rows);
  return csvResponse(csv, def.filename(ctx), {
    headers: { "Cache-Control": "no-store" },
  });
}
