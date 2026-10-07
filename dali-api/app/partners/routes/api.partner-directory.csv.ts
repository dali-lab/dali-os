// GET /api/partner-directory.csv?view=orgs|contacts
// Resource route — no default export, no layout wrapping (see the forms
// responses CSV export for the same bare-body reasoning).

import { redirect } from "react-router";
import type { Route } from "./+types/api.partner-directory.csv";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { csvResponse, rowsToCsv } from "~/lib/csv";
import {
  listPartnerContactRows,
  listPartnerOrgRows,
  partnerContactsCsvRows,
  partnerOrgsCsvRows,
} from "../lib/partner-directory";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const view = new URL(request.url).searchParams.get("view") === "contacts" ? "contacts" : "orgs";
  const fileStamp = new Date().toISOString().slice(0, 10);

  if (view === "contacts") {
    const contacts = await listPartnerContactRows();
    const csv = rowsToCsv(partnerContactsCsvRows(contacts));
    return csvResponse(csv, `partner-contacts-${fileStamp}.csv`, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const orgs = await listPartnerOrgRows();
  const csv = rowsToCsv(partnerOrgsCsvRows(orgs));
  return csvResponse(csv, `partner-orgs-${fileStamp}.csv`, {
    headers: { "Cache-Control": "no-store" },
  });
}
