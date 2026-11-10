import type { Route } from "./+types/api.partner-activity";
import { requireCore } from "~/lib/auth";
import { loadPartnerActivityPage } from "../lib/partner-activity-page.server";

// GET /api/partner-activity?orgId=|contactId=&cursor= — older timeline rows for
// the org and contact pages. Core only, like those pages.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const contactId = url.searchParams.get("contactId");
  if (!orgId === !contactId) {
    return Response.json({ error: "Pass exactly one of orgId or contactId" }, { status: 400 });
  }
  const scope = orgId ? { orgId } : { contactId: contactId! };
  return Response.json(await loadPartnerActivityPage(scope, url.searchParams.get("cursor")));
}
