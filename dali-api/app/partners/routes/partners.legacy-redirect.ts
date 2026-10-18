// Bookmarks for the pre-regroup /partners URLs. One file serves every old
// path — /partners, /partners/applications, /partners/applications/:id, and
// /partners/:orgId — registered under four distinct route ids in
// app/routes.ts. The mapping is driven by the actual requested pathname
// (mapLegacyPartnerPath), not by which registration matched, since they all
// share this one loader.

import { redirect } from "react-router";
import { mapLegacyPartnerPath } from "../lib/legacy-paths";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return redirect(mapLegacyPartnerPath(url.pathname, url.search));
}
