import type { Route } from "./+types/api.export.$exportId.export.csv";
import { runCsvExport } from "~/lib/csv-export.server";

// Resource route (GET) — registered OUTSIDE the app layout so the Response
// streams as a bare CSV body, matching the existing payroll/forms export
// routes. One route serves every registered export; see
// app/lib/csv-export.server.ts for the registry mechanism and
// app/lib/csv-exports.server.ts for the list of registered exports.

export async function loader({ request, params }: Route.LoaderArgs) {
  return runCsvExport(params.exportId, request, params);
}
