// GET /api/partner-directory.csv?q=&kind=&type=&status=&org= (kind, type,
// status and org repeat for multi-value filters — the same columns the
// Directory's filter bar offers)
// Resource route — no default export, no layout wrapping (see the forms
// responses CSV export for the same bare-body reasoning).

import { redirect } from "react-router";
import type { Route } from "./+types/api.partner-directory.csv";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { csvResponse, rowsToCsv } from "~/lib/csv";
import {
  directoryFiltersFromParams,
  filterDirectoryRows,
  partnerDirectoryCsvRows,
} from "../lib/partner-directory";
import { listPartnerDirectoryRows } from "../lib/partner-directory.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const params = new URL(request.url).searchParams;
  const fileStamp = new Date().toISOString().slice(0, 10);

  const rows = await listPartnerDirectoryRows();
  const filtered = filterDirectoryRows(
    rows,
    params.get("q") ?? "",
    directoryFiltersFromParams(params),
  );
  const csv = rowsToCsv(partnerDirectoryCsvRows(filtered));
  return csvResponse(csv, `partner-directory-${fileStamp}.csv`, {
    headers: { "Cache-Control": "no-store" },
  });
}
